/* @flow */
import BN from 'bn.js';
import {
  OPCODE_TO_BYTECODE,
  type OpCode,
  common,
  crypto,
  utils,
} from 'neo-blockchain-core';

import _ from 'lodash';

import {
  ArrayStackItem,
  BooleanStackItem,
  BufferStackItem,
  IntegerStackItem,
  StructStackItem,
  UInt160StackItem,
  UInt256StackItem,
} from './stackItem';
import {
  type ExecutionContext,
  type Op,
  type OpInvoke,
  type OpInvokeArgs,
} from './constants';
import {
  CodeOverflowError,
  InvalidCheckMultisigArgumentsError,
  InvalidPackCountError,
  InvalidPickItemIndexError,
  InvalidSetItemIndexError,
  LeftNegativeError,
  PickNegativeError,
  RightLengthError,
  RightNegativeError,
  RollNegativeError,
  PushOnlyError,
  SubstrNegativeEndError,
  SubstrNegativeStartError,
  ThrowError,
  UnknownOpError,
  XDropNegativeError,
  XSwapNegativeError,
  XTuckNegativeError,
} from './errors';

import { lookupSysCall } from './syscalls';
import vmUtils from './vmUtils';

export type CreateOpArgs = {| context: ExecutionContext |};
export type CreateOp = (input: CreateOpArgs) => Op;
export const createOp = ({
  name,
  in: in_,
  inAlt,
  out,
  outAlt,
  modify,
  modifyAlt,
  invocation,
  array,
  item,
  fee,
  invoke,
}: {|
  name: OpCode,
  in?: number,
  inAlt?: number,
  out?: number,
  outAlt?: number,
  modify?: number,
  modifyAlt?: number,
  invocation?: number,
  array?: number,
  item?: number,
  fee?: BN,
  invoke: OpInvoke,
|}): CreateOp => ({ context }) => ({
  name,
  in: in_ || 0,
  inAlt: inAlt || 0,
  out: out || 0,
  outAlt: outAlt || 0,
  modify: modify || 0,
  modifyAlt: modifyAlt || 0,
  invocation: invocation || 0,
  array: array || 0,
  item: item || 0,
  fee: fee || utils.ZERO,
  invoke,
  context,
});

const pushNumber = ({
  name,
  value,
}: {|
  name: OpCode,
  value: number,
|}) => createOp({
  name,
  out: 1,
  invoke: ({ context }: OpInvokeArgs) => ({
    context,
    results: [new IntegerStackItem(new BN(value))],
  }),
});

const pushData = ({
  name,
  numBytes,
}: {|
  name: OpCode,
  numBytes: 1 | 2 | 4,
|}) => createOp({
  name,
  out: 1,
  invoke: ({ context }: OpInvokeArgs) => {
    const { code, pc } = context;
    let size;
    if (numBytes === 1) {
      size = code.readUInt8(context.pc);
    } else if (numBytes === 2) {
      size = code.readUInt16LE(pc);
    } else {
      size = code.readInt32LE(pc);
    }

    if (code.length < pc + numBytes + size - 1) {
      throw new CodeOverflowError();
    }

    return {
      context: {
        ...context,
        pc: pc + numBytes + size,
      },
      results: [
        new BufferStackItem(code.slice(pc + numBytes, pc + numBytes + size)),
      ],
    };
  },
});

const jump = ({
  name,
  checkTrue,
}: {|
  name: OpCode,
  checkTrue?: boolean,
|}) => createOp({
  name,
  in: checkTrue == null ? 0 : 1,
  invoke: ({ context, args }: OpInvokeArgs) => {
    const { code } = context;
    let { pc } = context;
    const offset = code.readInt16LE(pc);
    pc += 2;
    const newPC = pc + offset - 3;
    if (newPC < 0 || newPC > code.length) {
      throw new CodeOverflowError();
    }

    let shouldJump = true;
    if (checkTrue != null) {
      shouldJump = args[0].asBoolean();
      if (!checkTrue) {
        shouldJump = !shouldJump;
      }
    }

    return {
      context: ({
        ...context,
        pc: shouldJump ? newPC : pc,
      }),
    };
  },
});

const call = ({
  name,
  tailCall,
}: {|
  name: OpCode,
  tailCall?: boolean,
|}) => createOp({
  name,
  invocation: tailCall ? 0 : 1,
  invoke: async ({ context }: OpInvokeArgs) => {
    const { pc } = context;
    const hash = common.bufferToUInt160(context.code.slice(pc, pc + 20));
    const contract = await context.blockchain.contract.get({ hash });
    const resultContext = await context.engine.executeScript({
      code: contract.script,
      blockchain: context.blockchain,
      init: context.init,
      gasLeft: context.gasLeft,
      options: {
        stack: context.stack,
        stackAlt: context.stackAlt,
        depth: tailCall ? context.depth : context.depth + 1,
        actionIndex: context.actionIndex,
        createdContracts: context.createdContracts,
        scriptHash: context.scriptHash,
        entryScriptHash: context.entryScriptHash,
      },
    });

    return {
      context: {
        ...resultContext,
        code: context.code,
        pc: pc + 20,
        done: !!tailCall,
        depth: context.depth,
      },
    };
  },
});

const JMP = jump({ name: 'JMP' });

const OPCODE_PAIRS = [
  [0x00, createOp({
    name: 'PUSH0',
    out: 1,
    invoke: ({ context }: OpInvokeArgs) => ({
      context,
      results: [
        new BufferStackItem(Buffer.alloc(0, 0)),
      ],
    }),
  })],
].concat(
  _.range(0x01, 0x4C).map(idx => [
    idx,
    createOp({
      name: (`PUSHBYTES${idx}`: any),
      out: 1,
      invoke: ({ context }: OpInvokeArgs) => ({
        context: {
          ...context,
          pc: context.pc + idx,
        },
        results: [
          new BufferStackItem(context.code.slice(context.pc, context.pc + idx)),
        ],
      }),
    }),
  ]),
).concat([
  [0x4C, pushData({ name: 'PUSHDATA1', numBytes: 1 })],
  [0x4D, pushData({ name: 'PUSHDATA2', numBytes: 2 })],
  [0x4E, pushData({ name: 'PUSHDATA4', numBytes: 4 })],
  [0x4F, pushNumber({ name: 'PUSHM1', value: -1 })],
]).concat(
  _.range(0x51, 0x61).map(idx => {
    const value = idx - 0x50;
    return [idx, pushNumber({ name: (`PUSH${value}`: any), value })];
  }),
).concat([
  [0x61, createOp({
    name: 'NOP',
    invoke: ({ context }: OpInvokeArgs) => ({ context }),
  })],
  [0x62, JMP],
  [0x63, jump({ name: 'JMPIF', checkTrue: true })],
  [0x64, jump({ name: 'JMPIFNOT', checkTrue: false })],
  [0x65, createOp({
    name: 'CALL',
    invocation: 1,
    invoke: async ({ context }: OpInvokeArgs) => {
      const { pc } = context;
      // High level:
      // Execute JMP in place of current op codes pc using same context
      // Continue running after JMP until done
      // Set current pc to pc + 2
      const op = JMP({ context });
      const { context: startContext } = await op.invoke({
        context: op.context,
        args: [],
        argsAlt: [],
      });
      const resultContext = await context.engine.run({
        context: {
          ...startContext,
          depth: context.depth + 1,
        },
      });

      return {
        context: {
          ...resultContext,
          pc: pc + 2,
          done: false,
          depth: context.depth,
        },
      };
    },
  })],
  [0x66, createOp({
    name: 'RET',
    invoke: ({ context }: OpInvokeArgs) => ({
      context: { ...context, done: true },
    }),
  })],
  [0x67, call({ name: 'APPCALL' })],
  [0x68, ({ context }: CreateOpArgs) => {
    const sysCall = lookupSysCall({ context });
    return {
      name: 'SYSCALL',
      in: sysCall.in,
      inAlt: sysCall.inAlt,
      out: sysCall.out,
      outAlt: sysCall.outAlt,
      modify: sysCall.modify,
      modifyAlt: sysCall.modifyAlt,
      invocation: sysCall.invocation,
      array: sysCall.array,
      item: sysCall.item,
      fee: sysCall.fee,
      invoke: sysCall.invoke,
      context: sysCall.context,
    };
  }],
  [0x69, call({ name: 'TAILCALL', tailCall: true })],
  [0x6A, createOp({
    name: 'DUPFROMALTSTACK',
    inAlt: 1,
    out: 1,
    outAlt: 1,
    invoke: ({ context, argsAlt }: OpInvokeArgs) => ({
      context,
      results: [argsAlt[0]],
      resultsAlt: [argsAlt[0]],
    }),
  })],
  [0x6B, createOp({
    name: 'TOALTSTACK',
    in: 1,
    outAlt: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      resultsAlt: [args[0]],
    }),
  })],
  [0x6C, createOp({
    name: 'FROMALTSTACK',
    inAlt: 1,
    out: 1,
    invoke: ({ context, argsAlt }: OpInvokeArgs) => ({
      context,
      results: [argsAlt[0]],
    }),
  })],
  [0x6D, createOp({
    name: 'XDROP',
    in: 1,
    modify: -1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const n = vmUtils.toNumber(context, args[0].asBigInteger());
      if (n < 0) {
        throw new XDropNegativeError();
      }

      const { stack } = context;
      return {
        context: {
          ...context,
          stack: stack.slice(0, n).concat(stack.slice(n + 1)),
        },
      };
    },
  })],
  [0x72, createOp({
    name: 'XSWAP',
    in: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const n = vmUtils.toNumber(context, args[0].asBigInteger());
      if (n < 0) {
        throw new XSwapNegativeError();
      }

      const stack = [...context.stack];
      stack[n] = context.stack[0];
      stack[0] = context.stack[n];

      return { context: { ...context, stack } };
    },
  })],
  [0x73, createOp({
    name: 'XTUCK',
    in: 1,
    modify: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const n = vmUtils.toNumber(context, args[0].asBigInteger());
      if (n <= 0) {
        throw new XTuckNegativeError();
      }

      const { stack } = context;
      return {
        context: {
          ...context,
          stack:
            stack.slice(0, n).concat([stack[0]]).concat(stack.slice(n)),
        },
      };
    },
  })],
  [0x74, createOp({
    name: 'DEPTH',
    out: 1,
    invoke: ({ context }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(new BN(context.stack.length))],
    }),
  })],
  [0x75, createOp({
    name: 'DROP',
    in: 1,
    invoke: ({ context }: OpInvokeArgs) => ({ context }),
  })],
  [0x76, createOp({
    name: 'DUP',
    in: 1,
    out: 2,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[0], args[0]] }),
  })],
  [0x77, createOp({
    name: 'NIP',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[0]] }),
  })],
  [0x78, createOp({
    name: 'OVER',
    in: 2,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[1], args[0], args[1]] }),
  })],
  [0x79, createOp({
    name: 'PICK',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const n = vmUtils.toNumber(context, args[0].asBigInteger());
      if (n < 0) {
        throw new PickNegativeError();
      }

      return { context, results: [context.stack[n]] };
    },
  })],
  [0x7A, createOp({
    name: 'ROLL',
    in: 1,
    out: 1,
    modify: -1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const n = vmUtils.toNumber(context, args[0].asBigInteger());
      if (n < 0) {
        throw new RollNegativeError();
      }

      const { stack } = context;
      return {
        context: {
          ...context,
          stack: stack.slice(0, n).concat(stack.slice(n + 1)),
        },
        results: [context.stack[n]],
      };
    },
  })],
  [0x7B, createOp({
    name: 'ROT',
    in: 3,
    out: 3,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[1], args[0], args[2]] }),
  })],
  [0x7C, createOp({
    name: 'SWAP',
    in: 2,
    out: 2,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[0], args[1]] }),
  })],
  [0x7D, createOp({
    name: 'TUCK',
    in: 2,
    out: 3,
    invoke: ({ context, args }: OpInvokeArgs) =>
      ({ context, results: [args[0], args[1], args[0]] }),
  })],
  [0x7E, createOp({
    name: 'CAT',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BufferStackItem(
        Buffer.concat([args[1].asBuffer(), args[0].asBuffer()]),
      )],
    }),
  })],
  [0x7F, createOp({
    name: 'SUBSTR',
    in: 3,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const end = vmUtils.toNumber(context, args[0].asBigInteger());
      if (end < 0) {
        throw new SubstrNegativeEndError();
      }

      const start = vmUtils.toNumber(context, args[1].asBigInteger());
      if (start < 0) {
        throw new SubstrNegativeStartError();
      }

      return {
        context,
        results: [new BufferStackItem(
          args[2].asBuffer().slice(start, start + end),
        )],
      };
    },
  })],
  [0x80, createOp({
    name: 'LEFT',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const count = vmUtils.toNumber(context, args[0].asBigInteger());
      if (count < 0) {
        throw new LeftNegativeError();
      }

      return {
        context,
        results: [new BufferStackItem(
          args[1].asBuffer().slice(0, count)
        )],
      };
    },
  })],
  [0x81, createOp({
    name: 'RIGHT',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const count = vmUtils.toNumber(context, args[0].asBigInteger());
      if (count < 0) {
        throw new RightNegativeError();
      }

      const value = args[1].asBuffer();
      if (value.length < count) {
        throw new RightLengthError();
      }

      return {
        context,
        results: [new BufferStackItem(
          value.slice(-count)
        )],
      };
    },
  })],
  [0x82, createOp({
    name: 'SIZE',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asBuffer().length),
      )],
    }),
  })],
  [0x83, createOp({
    name: 'INVERT',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        utils.not(args[0].asBigInteger())
      )],
    }),
  })],
  [0x84, createOp({
    name: 'AND',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBigInteger().and(args[1].asBigInteger()),
      )],
    }),
  })],
  [0x85, createOp({
    name: 'OR',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBigInteger().or(args[1].asBigInteger()),
      )],
    }),
  })],
  [0x86, createOp({
    name: 'XOR',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBigInteger().xor(args[1].asBigInteger()),
      )],
    }),
  })],
  [0x87, createOp({
    name: 'EQUAL',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[0].equals(args[1]),
      )],
    }),
  })],
  // [0x88, createOp({
  //   name: 'OP_EQUALVERIFY',
  //   invoke: ({ context }: OpInvokeArgs) => ({ context }),
  // })],
  // [0x89, createOp({
  //   name: 'OP_RESERVED1',
  //   invoke: ({ context }: OpInvokeArgs) => ({ context }),
  // })],
  // [0x8A, createOp({
  //   name: 'OP_RESERVED2',
  //   invoke: ({ context }: OpInvokeArgs) => ({ context }),
  // })],
  [0x8B, createOp({
    name: 'INC',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [
        new IntegerStackItem(
          args[0].asBigInteger().add(utils.ONE)
        ),
      ],
    }),
  })],
  [0x8C, createOp({
    name: 'DEC',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [
        new IntegerStackItem(
          args[0].asBigInteger().sub(utils.ONE)
        ),
      ],
    }),
  })],
  [0x8D, createOp({
    name: 'SIGN',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const value = args[0].asBigInteger();
      const results = [];
      if (value.isZero()) {
        results.push(new IntegerStackItem(
          utils.ZERO,
        ));
      } else if (value.isNeg()) {
        results.push(new IntegerStackItem(
          utils.NEGATIVE_ONE,
        ));
      } else {
        results.push(new IntegerStackItem(
          utils.ONE,
        ));
      }

      return { context, results };
    },
  })],
  [0x8F, createOp({
    name: 'NEGATE',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [
        new IntegerStackItem(
          args[0].asBigInteger().neg(),
        ),
      ],
    }),
  })],
  [0x90, createOp({
    name: 'ABS',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [
        new IntegerStackItem(
          args[0].asBigInteger().abs(),
        ),
      ],
    }),
  })],
  [0x91, createOp({
    name: 'NOT',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        !args[0].asBoolean()
      )],
    }),
  })],
  [0x92, createOp({
    name: 'NZ',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        !args[0].asBigInteger().isZero(),
      )],
    }),
  })],
  [0x93, createOp({
    name: 'ADD',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[1].asBigInteger().add(args[0].asBigInteger()),
      )],
    }),
  })],
  [0x94, createOp({
    name: 'SUB',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[1].asBigInteger().sub(args[0].asBigInteger()),
      )],
    }),
  })],
  [0x95, createOp({
    name: 'MUL',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[1].asBigInteger().mul(args[0].asBigInteger()),
      )],
    }),
  })],
  [0x96, createOp({
    name: 'DIV',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[1].asBigInteger().div(args[0].asBigInteger()),
      )],
    }),
  })],
  [0x97, createOp({
    name: 'MOD',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[1].asBigInteger().mod(args[0].asBigInteger()),
      )],
    }),
  })],
  [0x98, createOp({
    name: 'SHL',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBigInteger().shln(vmUtils.toNumber(context, args[1].asBigInteger())),
      )],
    }),
  })],
  [0x99, createOp({
    name: 'SHR',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBigInteger().shrn(vmUtils.toNumber(context, args[1].asBigInteger())),
      )],
    }),
  })],
  [0x9A, createOp({
    name: 'BOOLAND',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[0].asBoolean() && args[1].asBoolean(),
      )],
    }),
  })],
  [0x9B, createOp({
    name: 'BOOLOR',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[0].asBoolean() || args[1].asBoolean(),
      )],
    }),
  })],
  [0x9C, createOp({
    name: 'NUMEQUAL',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[0].asBigInteger().eq(args[1].asBigInteger()),
      )],
    }),
  })],
  [0x9E, createOp({
    name: 'NUMNOTEQUAL',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        !args[0].asBigInteger().eq(args[1].asBigInteger()),
      )],
    }),
  })],
  [0x9F, createOp({
    name: 'LT',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[1].asBigInteger().lt(args[0].asBigInteger()),
      )],
    }),
  })],
  [0xA0, createOp({
    name: 'GT',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[1].asBigInteger().gt(args[0].asBigInteger()),
      )],
    }),
  })],
  [0xA1, createOp({
    name: 'LTE',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[1].asBigInteger().lte(args[0].asBigInteger()),
      )],
    }),
  })],
  [0xA2, createOp({
    name: 'GTE',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[1].asBigInteger().gte(args[0].asBigInteger()),
      )],
    }),
  })],
  [0xA3, createOp({
    name: 'MIN',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        BN.min(
          args[1].asBigInteger(),
          args[0].asBigInteger()
        ),
      )],
    }),
  })],
  [0xA4, createOp({
    name: 'MAX',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        BN.max(
          args[1].asBigInteger(),
          args[0].asBigInteger()
        ),
      )],
    }),
  })],
  [0xA5, createOp({
    name: 'WITHIN',
    in: 3,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        args[1].asBigInteger().lte(args[2].asBigInteger()) &&
        args[2].asBigInteger().lt(args[0].asBigInteger())
      )],
    }),
  })],
  [0xA7, createOp({
    name: 'SHA1',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BufferStackItem(
        crypto.sha1(args[0].asBuffer()),
      )],
    }),
  })],
  [0xA8, createOp({
    name: 'SHA256',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BufferStackItem(
        crypto.sha256(args[0].asBuffer()),
      )],
    }),
  })],
  [0xA9, createOp({
    name: 'HASH160',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        crypto.hash160(args[0].asBuffer()),
      )],
    }),
  })],
  [0xAA, createOp({
    name: 'HASH256',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        crypto.hash256(args[0].asBuffer()),
      )],
    }),
  })],
  [0xAC, createOp({
    name: 'CHECKSIG',
    in: 2,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const publicKey = args[0].asBuffer();
      const signature = args[1].asBuffer();
      let result;
      try {
        result = await crypto.verify({
          message: context.init.scriptContainer.value.message,
          signature,
          publicKey,
        });
      } catch (error) {
        result = false;
      }
      return {
        context,
        results: [new BooleanStackItem(result)],
      };
    },
  })],
  [0xAE, ({ context: contextIn }: CreateOpArgs) => {
    const { stack } = contextIn;
    const top = stack[0];
    let in_;
    if (top == null || top.isArray()) {
      in_ = 1;
    } else {
      const count = vmUtils.toNumber(contextIn, top.asBigInteger());
      if (count <= 0) {
        throw new InvalidCheckMultisigArgumentsError();
      }
      in_ = 1 + count
    }

    const next = stack[in_];
    if (next == null || next.isArray()) {
      in_ += 1;
    } else {
      const count = vmUtils.toNumber(contextIn, next.asBigInteger());
      if (count < 0) {
        throw new InvalidCheckMultisigArgumentsError();
      }
      in_ += 1 + count;
    }

    return createOp({
      name: 'CHECKMULTISIG',
      in: in_,
      out: 1,
      invoke: ({ context, args }: OpInvokeArgs) => {
        let index;
        let publicKeys;
        if (args[0].isArray()) {
          index = 1;
          publicKeys = args[0].asArray().map(value => value.asBuffer());
        } else {
          const count = vmUtils.toNumber(context, args[0].asBigInteger());
          index = 1 + count;
          publicKeys = args.slice(1, index).map(value => value.asBuffer());
        }

        let signatures;
        if (args[index].isArray()) {
          signatures = args[index].asArray().map(value => value.asBuffer());
        } else {
          signatures = args.slice(index + 1).map(value => value.asBuffer());
        }

        if (
          publicKeys.length === 0 ||
          signatures.length === 0 ||
          signatures.length > publicKeys.length
        ) {
          throw new InvalidCheckMultisigArgumentsError();
        }

        let result = true;
        const n = publicKeys.length;
        const m = signatures.length;
        try {
          for (let i = 0, j = 0; result && i < m && j < n;) {
            const currentResult = crypto.verify({
              message: context.init.scriptContainer.value.message,
              signature: signatures[i],
              publicKey: publicKeys[j],
            });
            if (currentResult) {
              i += 1;
            }
            j += 1;
            if (m - i > n - j) {
              result = false;
            }
          }
        } catch (error) {
          result = false;
        }

        return {
          context,
          results: [new BooleanStackItem(
            result,
          )],
        };
      },
    })({ context: contextIn });
  }],
  [0xC0, createOp({
    name: 'ARRAYSIZE',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(
          args[0].isArray()
            ? args[0].asArray().length
            : args[0].asBuffer().length
        ),
      )],
    }),
  })],
  [0xC1, ({ context: contextIn }: CreateOpArgs) => {
    const { stack } = contextIn;
    const top = stack[0];
    let in_;
    if (top == null) {
      in_ = 1;
    } else {
      in_ = 1 + vmUtils.toNumber(contextIn, top.asBigInteger());

      if (in_ < 0) {
        throw new InvalidPackCountError();
      }
    }

    return createOp({
      name: 'PACK',
      in: in_,
      out: 1,
      invoke: ({ context, args }: OpInvokeArgs) => ({
        context,
        results: [new ArrayStackItem(
          args.slice(1),
        )]
      }),
    })({ context: contextIn });
  }],
  [0xC2, ({ context: contextIn }: CreateOpArgs) => {
    const { stack } = contextIn;
    const top = stack[0];
    let out;
    if (top == null) {
      out = 1;
    } else {
      out = 1 + top.asArray().length;
    }

    return createOp({
      name: 'UNPACK',
      in: 1,
      out,
      invoke: ({ context, args }: OpInvokeArgs) => {
        const arr = args[0].asArray();
        const results = [];
        for (let i = arr.length - 1; i >= 0; i -= 1) {
          results.push(arr[i]);
        }
        results.push(new IntegerStackItem(
          new BN(arr.length)
        ));

        return { context, results };
      },
    })({ context: contextIn });
  }],
  [0xC3, createOp({
    name: 'PICKITEM',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const index = vmUtils.toNumber(context, args[0].asBigInteger());
      const value = args[1].asArray();
      if (index < 0 || index >= value.length) {
        throw new InvalidPickItemIndexError();
      }

      return { context, results: [value[index]] };
    },
  })],
  [0xC4, createOp({
    name: 'SETITEM',
    in: 3,
    invoke: ({ context, args }: OpInvokeArgs) => {
      let newItem = args[0];
      if (newItem instanceof StructStackItem) {
        newItem = newItem.clone();
      }
      const index = vmUtils.toNumber(context, args[1].asBigInteger());
      const value = args[2].asArray();
      if (index < 0 || index >= value.length) {
        throw new InvalidSetItemIndexError();
      }

      value[index] = newItem;
      return { context };
    },
  })],
  [0xC5, createOp({
    name: 'NEWARRAY',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        _.range(0, vmUtils.toNumber(context, args[0].asBigInteger())).map(
          () => new BooleanStackItem(false),
        ),
      )],
    }),
  })],
  [0xC6, createOp({
    name: 'NEWSTRUCT',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new StructStackItem(
        _.range(0, vmUtils.toNumber(context, args[0].asBigInteger())).map(
          () => new BooleanStackItem(
            false,
          ),
        ),
      )],
    }),
  })],
  [0xF0, createOp({
    name: 'THROW',
    invoke: ({ context }: OpInvokeArgs) => {
      throw new ThrowError(context);
    },
  })],
  [0xF1, createOp({
    name: 'THROWIFNOT',
    in: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      if (!args[0].asBoolean()) {
        throw new ThrowError(context);
      }
      return { context };
    },
  })],
]);

export const OPCODES =
  (_.fromPairs(OPCODE_PAIRS): { [byte: number]: CreateOp });

export const lookupOp = ({
  context,
}: {|
  context: ExecutionContext,
|}) => {
  const opCode = context.code[context.pc];
  const create = OPCODES[opCode];
  if (create == null) {
    throw new UnknownOpError(context, `${opCode}`);
  }

  if (
    opCode > OPCODE_TO_BYTECODE.PUSH16 &&
    opCode !== OPCODE_TO_BYTECODE.RET &&
    context.PushOnly
  ) {
    throw new PushOnlyError(opCode);
  }

  return create({
    context: ({
      ...context,
      pc: context.pc + 1,
    }: $FlowFixMe),
  });
};
