/* @flow */
import BN from 'bn.js';
import { Observable } from 'rxjs';
import {
  ASSET_TYPE,
  SCRIPT_CONTAINER_TYPE,
  TRANSACTION_TYPE,
  type ECPoint,
  type SysCallName,
  type UInt160,
  type UInt256,
  Asset,
  Contract,
  StorageItem,
  Validator,
  BinaryReader,
  LogAction,
  NotificationAction,
  InvalidScriptContainerTypeError,
  assertAssetType,
  assertContractParameterType,
  common,
  crypto,
  utils,
} from 'neo-blockchain-core';

import {
  type StackItem,
  AccountStackItem,
  ArrayStackItem,
  AssetStackItem,
  AttributeStackItem,
  BlockStackItem,
  BooleanStackItem,
  BufferStackItem,
  ContractStackItem,
  ECPointStackItem,
  HeaderStackItem,
  IntegerStackItem,
  InputStackItem,
  OutputStackItem,
  StorageContextStackItem,
  TransactionStackItem,
  UInt160StackItem,
  UInt256StackItem,
  ValidatorStackItem,
} from './stackItem';
import {
  type ExecutionContext,
  type OpInvoke,
  type OpInvokeArgs,
  type SysCall,
  BLOCK_HEIGHT_YEAR,
  MAX_VOTES,
} from './constants';
import {
  AccountFrozenError,
  BadWitnessCheckError,
  ContractNoStorageError,
  InvalidAssetTypeError,
  InvalidContractGetStorageContextError,
  InvalidGetBlockArgumentsError,
  InvalidGetHeaderArgumentsError,
  InvalidIndexError,
  NotEligibleVoteError,
  TooManyVotesError,
  UnexpectedScriptContainerError,
  UnknownSysCallError,
} from './errors';

import vmUtils from './vmUtils';

export type CreateSysCallArgs = {| context: ExecutionContext |};
export type CreateSysCall = (input: CreateSysCallArgs) => SysCall;
export const createSysCall = ({
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
  name: SysCallName,
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
|}): CreateSysCall => ({ context }) => ({
  context,
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
});

const getHashOrIndex = ({
  arg,
}: {
  arg: StackItem,
}): ?(UInt256 | number) => {
  const buffer = arg.asBuffer();
  let hashOrIndex;
  if (buffer.length === 32) {
    hashOrIndex = common.bufferToUInt256(utils.reverse(buffer));
  } else if (buffer.length <= 5) {
    hashOrIndex = arg.asBigInteger().toNumber();
  }

  return hashOrIndex;
};

function getIndex<T>(index: number, values: Array<T>): T {
  if (index < 0 || index >= values.length) {
    throw new InvalidIndexError();
  }

  return values[index];
};

const checkWitness = async ({
  context,
  hash,
}: {|
  context: ExecutionContext,
  hash: UInt160,
|}) => {
  const scriptContainer = context.init.scriptContainer;
  let scriptHashesForVerifiying;
  switch (scriptContainer.type) {
    case 0x00:
      scriptHashesForVerifiying =
        await scriptContainer.value.getScriptHashesForVerifying({
          getOutput: context.blockchain.output.get,
          getAsset: context.blockchain.asset.get,
        });
      break;
    case 0x01:
      scriptHashesForVerifiying =
        await scriptContainer.value.getScriptHashesForVerifying({
          getHeader: context.blockchain.header.get,
        });
      break;
    default:
      // eslint-disable-next-line
      (scriptContainer.type: empty);
      throw new InvalidScriptContainerTypeError(scriptContainer.type);
  }
  return scriptHashesForVerifiying.has(common.uInt160ToHex(hash));
};

const checkWitnessPublicKey = ({
  context,
  publicKey,
}: {|
  context: ExecutionContext,
  publicKey: ECPoint,
|}) => checkWitness({
  context,
  hash: crypto.getVerificationScriptHash(publicKey)
});

const checkWitnessBuffer = ({
  context,
  hashOrPublicKey,
}: {|
  context: ExecutionContext,
  hashOrPublicKey: Buffer,
|}) => {
  if (hashOrPublicKey.length === common.ECPOINT_BUFFER_BYTES) {
    return checkWitnessPublicKey({
      context,
      publicKey: common.bufferToECPoint(hashOrPublicKey),
    });
  }
  return checkWitness({
    context,
    hash: common.bufferToUInt160(hashOrPublicKey),
  });
};

const createContract = async ({
  context,
  args,
}: {|
  context: ExecutionContext,
  args: Array<StackItem>,
|}) => {
  const script = args[0].asBuffer();
  const parameterList = [...args[1].asBuffer()].map(
    parameter => assertContractParameterType(parameter),
  );
  const returnType = assertContractParameterType(
    args[2].asBigInteger().toNumber(),
  );
  const hasStorage = args[3].asBoolean();
  const name = args[4].asString();
  const codeVersion = args[5].asString();
  const author = args[6].asString();
  const email = args[7].asString();
  const description = args[8].asString();
  const hash = crypto.hash160(script);
  let contract = await context.blockchain.contract.tryGet({ hash });
  let created = false;
  if (contract == null) {
    contract = new Contract({
      script,
      parameterList,
      returnType,
      hasStorage,
      name,
      codeVersion,
      author,
      email,
      description,
      hash,
    });
    await context.blockchain.contract.add(contract);
    created = true;
  }

  return { contract, created };
};

const checkStorage = async ({
  context,
  hash,
}: {|
  context: ExecutionContext,
  hash: UInt160,
|}) => {
  const contract = await context.blockchain.contract.get({ hash });
  if (!contract.hasStorage) {
    throw new ContractNoStorageError(common.uInt160ToString(hash));
  }
  return contract;
};

export const SYSCALLS = {
  'Neo.Runtime.GetTrigger': createSysCall({
    name: 'Neo.Runtime.GetTrigger',
    out: 1,
    invoke: ({ context }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(context.init.triggerType),
      )],
    }),
  }),
  'Neo.Runtime.CheckWitness': createSysCall({
    name: 'Neo.Runtime.CheckWitness',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BooleanStackItem(
        await checkWitnessBuffer({
          context,
          hashOrPublicKey: args[0].asBuffer()
        }),
      )],
    }),
  }),
  'Neo.Runtime.Notify': createSysCall({
    name: 'Neo.Runtime.Notify',
    in: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const notification = new NotificationAction({
        blockIndex: context.init.action.blockIndex,
        blockHash: context.init.action.blockHash,
        transactionIndex: context.init.action.transactionIndex,
        transactionHash: context.init.action.transactionHash,
        index: context.actionIndex,
        scriptHash: context.scriptHash,
        args: args[0].asArray().map(item => item.toContractParameter()),
      });
      await context.blockchain.action.add(notification);
      return {
        context: {
          ...context,
          actionIndex: context.actionIndex + 1,
        },
      };
    },
  }),
  'Neo.Runtime.Log': createSysCall({
    name: 'Neo.Runtime.Log',
    in: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const log = new LogAction({
        blockIndex: context.init.action.blockIndex,
        blockHash: context.init.action.blockHash,
        transactionIndex: context.init.action.transactionIndex,
        transactionHash: context.init.action.transactionHash,
        index: context.actionIndex,
        scriptHash: context.scriptHash,
        message: args[0].asString(),
      });
      await context.blockchain.action.add(log);
      return {
        context: {
          ...context,
          actionIndex: context.actionIndex + 1,
        },
      };
    },
  }),
  'Neo.Blockchain.GetHeight': createSysCall({
    name: 'Neo.Blockchain.GetHeight',
    out: 1,
    invoke: ({ context }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(context.blockchain.currentBlock.index),
      )],
    }),
  }),
  'Neo.Blockchain.GetHeader': createSysCall({
    name: 'Neo.Blockchain.GetHeader',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hashOrIndex = getHashOrIndex({ arg: args[0] });
      if (hashOrIndex == null) {
        throw new InvalidGetHeaderArgumentsError();
      }
      const header = await context.blockchain.header.get({ hashOrIndex });
      return {
        context,
        results: [new HeaderStackItem(header)],
      };
    },
  }),
  'Neo.Blockchain.GetBlock': createSysCall({
    name: 'Neo.Blockchain.GetBlock',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hashOrIndex = getHashOrIndex({
        arg: args[0],
      });
      if (hashOrIndex == null) {
        throw new InvalidGetBlockArgumentsError(
          context,
          args[0].asBufferMaybe(),
        );
      }
      const block = await context.blockchain.block.get({ hashOrIndex });
      return {
        context,
        results: [new BlockStackItem(block)],
      };
    },
  }),
  'Neo.Blockchain.GetTransaction': createSysCall({
    name: 'Neo.Blockchain.GetTransaction',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const transaction = await context.blockchain.transaction.get({
        hash: args[0].asUInt256(),
      });
      return {
        context,
        results: [new TransactionStackItem(transaction)],
      };
    },
  }),
  'Neo.Blockchain.GetAccount': createSysCall({
    name: 'Neo.Blockchain.GetAccount',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const account = await context.blockchain.account.get({
        hash: args[0].asUInt160(),
      });
      return {
        context,
        results: [new AccountStackItem(account)],
      };
    },
  }),
  'Neo.Blockchain.GetValidators': createSysCall({
    name: 'Neo.Blockchain.GetValidators',
    out: 1,
    invoke: async ({ context }: OpInvokeArgs) => {
      const validators = await context.blockchain.validator.all.map(
        ({ publicKey }) => new ECPointStackItem(publicKey),
      ).toArray().toPromise();
      return {
        context,
        results: [new ArrayStackItem(validators)],
      };
    },
  }),
  'Neo.Blockchain.GetAsset': createSysCall({
    name: 'Neo.Blockchain.GetAsset',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const asset = await context.blockchain.asset.get({
        hash: args[0].asUInt256(),
      });
      return {
        context,
        results: [new AssetStackItem(asset)],
      };
    },
  }),
  'Neo.Blockchain.GetContract': createSysCall({
    name: 'Neo.Blockchain.GetContract',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const contract = await context.blockchain.contract.get({
        hash: args[0].asUInt160(),
      });
      return {
        context,
        results: [new ContractStackItem(contract)],
      };
    },
  }),
  'Neo.Header.GetHash': createSysCall({
    name: 'Neo.Header.GetHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [
        new UInt256StackItem(args[0].asBlockBase().hash),
      ],
    }),
  }),
  'Neo.Header.GetVersion': createSysCall({
    name: 'Neo.Header.GetVersion',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asBlockBase().version),
      )],
    }),
  }),
  'Neo.Header.GetPrevHash': createSysCall({
    name: 'Neo.Header.GetPrevHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asBlockBase().previousHash,
      )],
    }),
  }),
  'Neo.Header.GetMerkleRoot': createSysCall({
    name: 'Neo.Header.GetMerkleRoot',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asBlockBase().merkleRoot,
      )],
    }),
  }),
  'Neo.Header.GetTimestamp': createSysCall({
    name: 'Neo.Header.GetTimestamp',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asBlockBase().timestamp),
      )],
    }),
  }),
  'Neo.Header.GetConsensusData': createSysCall({
    name: 'Neo.Header.GetConsensusData',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asBlockBase().consensusData,
      )],
    }),
  }),
  'Neo.Header.GetNextConsensus': createSysCall({
    name: 'Neo.Header.GetNextConsensus',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        args[0].asBlockBase().nextConsensus,
      )],
    }),
  }),
  'Neo.Block.GetTransactionCount': createSysCall({
    name: 'Neo.Block.GetTransactionCount',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asBlock().transactions.length),
      )],
    }),
  }),
  'Neo.Block.GetTransactions': createSysCall({
    name: 'Neo.Block.GetTransactions',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        args[0].asBlock().transactions.map(
          transaction => new TransactionStackItem(transaction),
        ),
      )],
    }),
  }),
  'Neo.Block.GetTransaction': createSysCall({
    name: 'Neo.Block.GetTransaction',
    in: 2,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new TransactionStackItem(
        getIndex(
          args[1].asBigInteger().toNumber(),
          args[0].asBlock().transactions,
        ),
      )],
    }),
  }),
  'Neo.Transaction.GetHash': createSysCall({
    name: 'Neo.Transaction.GetHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asTransaction().hash,
      )],
    }),
  }),
  'Neo.Transaction.GetType': createSysCall({
    name: 'Neo.Transaction.GetType',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asTransaction().type),
      )],
    }),
  }),
  'Neo.Transaction.GetAttributes': createSysCall({
    name: 'Neo.Transaction.GetAttributes',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        args[0].asTransaction().attributes.map(
          attribute => new AttributeStackItem(attribute),
        ),
      )],
    }),
  }),
  'Neo.Transaction.GetInputs': createSysCall({
    name: 'Neo.Transaction.GetInputs',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        args[0].asTransaction().inputs.map(
          input => new InputStackItem(input),
        ),
      )],
    }),
  }),
  'Neo.Transaction.GetOutputs': createSysCall({
    name: 'Neo.Transaction.GetOutputs',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        args[0].asTransaction().outputs.map(
          (output) => new OutputStackItem(output),
        ),
      )],
    }),
  }),
  'Neo.Transaction.GetReferences': createSysCall({
    name: 'Neo.Transaction.GetReferences',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const outputs = await args[0].asTransaction().getReferences({
        getOutput: context.blockchain.output.get,
      });
      return {
        context,
        results: [new ArrayStackItem(
          outputs.map((output) => new OutputStackItem(output)),
        )],
      };
    },
  }),
  'Neo.Attribute.GetUsage': createSysCall({
    name: 'Neo.Attribute.GetUsage',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asAttribute().usage),
      )],
    }),
  }),
  'Neo.Attribute.GetData': createSysCall({
    name: 'Neo.Attribute.GetData',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [args[0].asAttributeStackItem().toValueStackItem()],
    }),
  }),
  'Neo.Input.GetHash': createSysCall({
    name: 'Neo.Input.GetHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asInput().hash,
      )],
    }),
  }),
  'Neo.Input.GetIndex': createSysCall({
    name: 'Neo.Input.GetIndex',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asInput().index),
      )],
    }),
  }),
  'Neo.Output.GetAssetId': createSysCall({
    name: 'Neo.Output.GetAssetId',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asOutput().asset,
      )],
    }),
  }),
  'Neo.Output.GetValue': createSysCall({
    name: 'Neo.Output.GetValue',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        args[0].asOutput().value,
      )],
    }),
  }),
  'Neo.Output.GetScriptHash': createSysCall({
    name: 'Neo.Output.GetScriptHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        args[0].asOutput().address,
      )],
    }),
  }),
  'Neo.Account.GetScriptHash': createSysCall({
    name: 'Neo.Account.GetScriptHash',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        args[0].asAccount().hash,
      )],
    }),
  }),
  'Neo.Account.GetVotes': createSysCall({
    name: 'Neo.Account.GetVotes',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ArrayStackItem(
        args[0].asAccount().votes.map(
          vote => new ECPointStackItem(vote),
        ),
      )],
    }),
  }),
  'Neo.Account.GetBalance': createSysCall({
    name: 'Neo.Account.GetBalance',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const account = args[0].asAccount();
      const accountState = await context.blockchain.account.get({
        hash: account.hash,
      });
      const asset = common.uInt256ToHex(args[1].asUInt256());
      const result = accountState.balances[asset] || utils.ZERO;
      return {
        context,
        results: [new IntegerStackItem(result)],
      };
    },
  }),
  'Neo.Asset.GetAssetId': createSysCall({
    name: 'Neo.Asset.GetAssetId',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt256StackItem(
        args[0].asAsset().hash,
      )],
    }),
  }),
  'Neo.Asset.GetAssetType': createSysCall({
    name: 'Neo.Asset.GetAssetType',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asAsset().type),
      )],
    }),
  }),
  'Neo.Asset.GetAmount': createSysCall({
    name: 'Neo.Asset.GetAmount',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asAsset().amount),
      )],
    }),
  }),
  'Neo.Asset.GetAvailable': createSysCall({
    name: 'Neo.Asset.GetAvailable',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asAsset().available),
      )],
    }),
  }),
  'Neo.Asset.GetPrecision': createSysCall({
    name: 'Neo.Asset.GetPrecision',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new IntegerStackItem(
        new BN(args[0].asAsset().precision),
      )],
    }),
  }),
  'Neo.Asset.GetOwner': createSysCall({
    name: 'Neo.Asset.GetOwner',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new ECPointStackItem(
        args[0].asAsset().owner,
      )],
    }),
  }),
  'Neo.Asset.GetAdmin': createSysCall({
    name: 'Neo.Asset.GetAdmin',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        args[0].asAsset().admin,
      )],
    }),
  }),
  'Neo.Asset.GetIssuer': createSysCall({
    name: 'Neo.Asset.GetIssuer',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(
        args[0].asAsset().issuer,
      )],
    }),
  }),
  'Neo.Contract.GetScript': createSysCall({
    name: 'Neo.Contract.GetScript',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => ({
      context,
      results: [new BufferStackItem(
        args[0].asContract().script,
      )],
    }),
  }),
  'Neo.Storage.GetContext': createSysCall({
    name: 'Neo.Storage.GetContext',
    out: 1,
    invoke: ({ context }: OpInvokeArgs) => ({
      context,
      results: [new StorageContextStackItem(
        context.scriptHash,
      )],
    }),
  }),
  'Neo.Storage.Get': createSysCall({
    name: 'Neo.Storage.Get',
    in: 2,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hash = vmUtils.toStorageContext(context, args[0]).value;
      await checkStorage({ context, hash });

      const item = await context.blockchain.storageItem.tryGet({
        hash,
        key: args[1].asBuffer(),
      });
      const result = item == null ? new Buffer([]) : item.value;
      return {
        context,
        results: [new BufferStackItem(result)],
      };
    },
  }),
  'Neo.Account.SetVotes': createSysCall({
    name: 'Neo.Account.SetVotes',
    in: 2,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const address = args[0].asAccount().hash;
      const votes = args[1].asArray().map(vote => vote.asECPoint());
      if (votes.length > MAX_VOTES) {
        throw new TooManyVotesError();
      }

      const account = await context.blockchain.account.get({ hash: address });
      const asset = context.blockchain.settings.governingToken.hashHex;
      const balance = account.balances[asset] || utils.ZERO;
      if (account.isFrozen) {
        throw new AccountFrozenError();
      }
      if (balance.isZero() && votes.length > 0) {
        throw new NotEligibleVoteError();
      }
      if (!checkWitness({ context, hash: address })) {
        throw new BadWitnessCheckError();
      }

      const newAccount = await context.blockchain.account.update(
        account,
        { votes },
      );
      if (newAccount.isDeletable()) {
        await context.blockchain.account.delete({ hash: address });
      }

      return { context };
    },
  }),
  'Neo.Validator.Register': createSysCall({
    name: 'Neo.Validator.Register',
    in: 1,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const publicKey = args[0].asECPoint();
      if (!checkWitnessPublicKey({ context, publicKey })) {
        throw new BadWitnessCheckError();
      }

      let validator = await context.blockchain.validator.tryGet({ publicKey });
      if (validator == null) {
        validator = new Validator({ publicKey });
        await context.blockchain.validator.add(validator);
      }

      return {
        context,
        results: [new ValidatorStackItem(validator)],
      };
    }
  }),
  'Neo.Asset.Create': createSysCall({
    name: 'Neo.Asset.Create',
    in: 7,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const scriptContainer = context.init.scriptContainer;
      if (scriptContainer.type !== SCRIPT_CONTAINER_TYPE.TRANSACTION) {
        throw new UnexpectedScriptContainerError();
      }
      const transaction = scriptContainer.value;
      if (transaction.type !== TRANSACTION_TYPE.INVOCATION) {
        throw new UnexpectedScriptContainerError();
      }

      const assetType = assertAssetType(args[0].asBigInteger().toNumber());
      if (
        assetType === ASSET_TYPE.GOVERNING_TOKEN ||
        assetType === ASSET_TYPE.UTILITY_TOKEN
      ) {
        throw new InvalidAssetTypeError();
      }

      const name = args[1].asString();
      const amount = args[2].asBigInteger();
      const precision = args[3].asBigInteger().toNumber();
      const owner = args[4].asECPoint();
      const admin = args[5].asUInt160();
      const issuer = args[6].asUInt160();

      if (!checkWitnessPublicKey({ context, publicKey: owner })) {
        throw new BadWitnessCheckError();
      }

      const asset = new Asset({
        hash: transaction.hash,
        type: assetType,
        name,
        amount,
        precision,
        owner,
        admin,
        issuer,
        expiration: context.blockchain.currentBlock.index + 1 + 2000000,
      });
      const result = new AssetStackItem(asset);
      await context.blockchain.asset.add(asset);

      return { context, results: [result] };
    },
  }),
  'Neo.Asset.Renew': createSysCall({
    name: 'Neo.Asset.Renew',
    in: 2,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hash = args[0].asAsset().hash;
      const years = args[1].asBigInteger();

      const asset = await context.blockchain.asset.get({ hash });
      let expiration = asset.expiration;
      if (expiration < context.blockchain.currentBlock.index + 1) {
        expiration = context.blockchain.currentBlock.index + 1;
      }

      let newExpiration =
        (new BN(expiration)).add(years.mul(new BN(BLOCK_HEIGHT_YEAR)));

      if (newExpiration.gt(utils.UINT_MAX)) {
        newExpiration = utils.UINT_MAX;
      }

      await context.blockchain.asset.update(asset, {
        expiration: newExpiration.toNumber(),
      });

      return {
        context,
        results: [new IntegerStackItem(newExpiration)],
      };
    },
  }),
  'Neo.Contract.Create': createSysCall({
    name: 'Neo.Contract.Create',
    in: 9,
    out: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const { contract } = await createContract({ context, args });
      const result = new ContractStackItem(contract);

      return {
        context: {
          ...context,
          createdContracts: {
            ...context.createdContracts,
            [(contract.hashHex: $FlowFixMe)]: context.scriptHash,
          },
        },
        results: [result],
      };
    },
  }),
  'Neo.Contract.Migrate': createSysCall({
    name: 'Neo.Contract.Migrate',
    in: 9,
    out: 1,
    invoke: async ({ context: contextIn, args }: OpInvokeArgs) => {
      let context = contextIn;
      const { contract, created } = await createContract({ context, args });
      if (contract.hasStorage && created) {
        await context.blockchain.storageItem.getAll({
          hash: context.scriptHash
        }).concatMap((item) => Observable.fromPromise(
          context.blockchain.storageItem.add(
            new StorageItem({
              hash: contract.hash,
              key: item.key,
              value: item.value,
            }),
          ),
        )).toPromise();
        context = {
          ...context,
          createdContracts: {
            ...context.createdContracts,
            [(contract.hashHex: $FlowFixMe)]: context.scriptHash,
          },
        };
      }

      return {
        context,
        results: [new ContractStackItem(contract)],
      };
    },
  }),
  'Neo.Contract.GetStorageContext': createSysCall({
    name: 'Neo.Contract.GetStorageContext',
    in: 1,
    out: 1,
    invoke: ({ context, args }: OpInvokeArgs) => {
      const contract = args[0].asContract();
      const createdScriptHash = context.createdContracts[contract.hashHex];
      if (!common.uInt160Equal(createdScriptHash, context.scriptHash)) {
        throw new InvalidContractGetStorageContextError();
      }

      return {
        context,
        results: [new StorageContextStackItem(contract.hash)],
      };
    },
  }),
  'Neo.Contract.Destroy': createSysCall({
    name: 'Neo.Contract.Destroy',
    in: 1,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hash = args[0].asUInt160();
      const contract = await context.blockchain.contract.tryGet({ hash });
      if (contract != null) {
        await Promise.all([
          context.blockchain.contract.delete({ hash }),
          contract.hasStorage
            ? context.blockchain.storageItem.getAll({ hash }).concatMap(
              (item) => Observable.fromPromise(
                context.blockchain.storageItem.delete({
                  hash,
                  key: item.key,
                }),
              ),
            ).toPromise()
            : Promise.resolve(),
        ]);
      }

      return { context };
    },
  }),
  'Neo.Storage.Put': createSysCall({
    name: 'Neo.Storage.Put',
    in: 3,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hash = vmUtils.toStorageContext(context, args[0]).value;
      await checkStorage({ context, hash });
      const key = args[1].asBuffer();
      const value = args[2].asBuffer();
      const item = await context.blockchain.storageItem.tryGet({ hash, key });
      if (item == null) {
        await context.blockchain.storageItem.add(
          new StorageItem({ hash, key, value }),
        );
      } else {
        await context.blockchain.storageItem.update(item, { value });
      }

      return { context };
    },
  }),
  'Neo.Storage.Delete': createSysCall({
    name: 'Neo.Storage.Delete',
    in: 2,
    invoke: async ({ context, args }: OpInvokeArgs) => {
      const hash = vmUtils.toStorageContext(context, args[0]).value;
      await checkStorage({ context, hash });
      const key = args[1].asBuffer();
      await context.blockchain.storageItem.delete({ hash, key });
      return { context };
    },
  }),
  'System.ExecutionEngine.GetScriptContainer': createSysCall({
    name: 'System.ExecutionEngine.GetScriptContainer',
    out: 1,
    invoke: async ({ context }: OpInvokeArgs) => {
      let result;
      const scriptContainer = context.init.scriptContainer;
      switch (scriptContainer.type) {
        case SCRIPT_CONTAINER_TYPE.TRANSACTION:
          result = new TransactionStackItem(scriptContainer.value);
          break;
        case SCRIPT_CONTAINER_TYPE.BLOCK:
          result = new BlockStackItem(scriptContainer.value);
          break;
        default:
          // eslint-disable-next-line
          (scriptContainer.type: empty);
          throw new InvalidScriptContainerTypeError(
            scriptContainer.type,
          );
      }
      return { context, results: [result] };
    },
  }),
  'System.ExecutionEngine.GetExecutingScriptHash': createSysCall({
    name: 'System.ExecutionEngine.GetExecutingScriptHash',
    out: 1,
    invoke: async ({ context }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(context.scriptHash)]
    }),
  }),
  'System.ExecutionEngine.GetCallingScriptHash': createSysCall({
    name: 'System.ExecutionEngine.GetCallingScriptHash',
    out: 1,
    invoke: async ({ context }: OpInvokeArgs) => ({
      context,
      results: [
        context.callingScriptHash == null
          ? new BufferStackItem(Buffer.alloc(0, 0))
          : new UInt160StackItem(context.callingScriptHash)
      ],
    }),
  }),
  'System.ExecutionEngine.GetEntryScriptHash': createSysCall({
    name: 'System.ExecutionEngine.GetEntryScriptHash',
    out: 1,
    invoke: async ({ context }: OpInvokeArgs) => ({
      context,
      results: [new UInt160StackItem(context.entryScriptHash)]
    }),
  }),
};

export const SYSCALL_ALIASES = {
  'AntShares.Runtime.CheckWitness': 'Neo.Runtime.CheckWitness',
  'AntShares.Runtime.Notify': 'Neo.Runtime.Notify',
  'AntShares.Runtime.Log': 'Neo.Runtime.Log',
  'AntShares.Blockchain.GetHeight': 'Neo.Blockchain.GetHeight',
  'AntShares.Blockchain.GetHeader': 'Neo.Blockchain.GetHeader',
  'AntShares.Blockchain.GetBlock': 'Neo.Blockchain.GetBlock',
  'AntShares.Blockchain.GetTransaction': 'Neo.Blockchain.GetTransaction',
  'AntShares.Blockchain.GetAccount': 'Neo.Blockchain.GetAccount',
  'AntShares.Blockchain.GetValidators': 'Neo.Blockchain.GetValidators',
  'AntShares.Blockchain.GetAsset': 'Neo.Blockchain.GetAsset',
  'AntShares.Blockchain.GetContract': 'Neo.Blockchain.GetContract',
  'AntShares.Header.GetHash': 'Neo.Header.GetHash',
  'AntShares.Header.GetVersion': 'Neo.Header.GetVersion',
  'AntShares.Header.GetPrevHash': 'Neo.Header.GetPrevHash',
  'AntShares.Header.GetMerkleRoot': 'Neo.Header.GetMerkleRoot',
  'AntShares.Header.GetTimestamp': 'Neo.Header.GetTimestamp',
  'AntShares.Header.GetConsensusData': 'Neo.Header.GetConsensusData',
  'AntShares.Header.GetNextConsensus': 'Neo.Header.GetNextConsensus',
  'AntShares.Block.GetTransactionCount': 'Neo.Block.GetTransactionCount',
  'AntShares.Block.GetTransactions': 'Neo.Block.GetTransactions',
  'AntShares.Block.GetTransaction': 'Neo.Block.GetTransaction',
  'AntShares.Transaction.GetHash': 'Neo.Transaction.GetHash',
  'AntShares.Transaction.GetType': 'Neo.Transaction.GetType',
  'AntShares.Transaction.GetAttributes': 'Neo.Transaction.GetAttributes',
  'AntShares.Transaction.GetInputs': 'Neo.Transaction.GetInputs',
  'AntShares.Transaction.GetOutputs': 'Neo.Transaction.GetOutputs',
  'AntShares.Transaction.GetReferences': 'Neo.Transaction.GetReferences',
  'AntShares.Attribute.GetUsage': 'Neo.Attribute.GetUsage',
  'AntShares.Attribute.GetData': 'Neo.Attribute.GetData',
  'AntShares.Input.GetHash': 'Neo.Input.GetHash',
  'AntShares.Input.GetIndex': 'Neo.Input.GetIndex',
  'AntShares.Output.GetAssetId': 'Neo.Output.GetAssetId',
  'AntShares.Output.GetValue': 'Neo.Output.GetValue',
  'AntShares.Output.GetScriptHash': 'Neo.Output.GetScriptHash',
  'AntShares.Account.GetScriptHash': 'Neo.Account.GetScriptHash',
  'AntShares.Account.GetVotes': 'Neo.Account.GetVotes',
  'AntShares.Account.GetBalance': 'Neo.Account.GetBalance',
  'AntShares.Asset.GetAssetId': 'Neo.Asset.GetAssetId',
  'AntShares.Asset.GetAssetType': 'Neo.Asset.GetAssetType',
  'AntShares.Asset.GetAmount': 'Neo.Asset.GetAmount',
  'AntShares.Asset.GetAvailable': 'Neo.Asset.GetAvailable',
  'AntShares.Asset.GetPrecision': 'Neo.Asset.GetPrecision',
  'AntShares.Asset.GetOwner': 'Neo.Asset.GetOwner',
  'AntShares.Asset.GetAdmin': 'Neo.Asset.GetAdmin',
  'AntShares.Asset.GetIssuer': 'Neo.Asset.GetIssuer',
  'AntShares.Contract.GetScript': 'Neo.Contract.GetScript',
  'AntShares.Storage.GetContext': 'Neo.Storage.GetContext',
  'AntShares.Storage.Get': 'Neo.Storage.Get',
  'AntShares.Account.SetVotes': 'Neo.Account.SetVotes',
  'AntShares.Validator.Register': 'Neo.Validator.Register',
  'AntShares.Asset.Create': 'Neo.Asset.Create',
  'AntShares.Asset.Renew': 'Neo.Asset.Renew',
  'AntShares.Contract.Create': 'Neo.Contract.Create',
  'AntShares.Contract.Migrate': 'Neo.Contract.Migrate',
  'AntShares.Contract.GetStorageContext': 'Neo.Contract.GetStorageContext',
  'AntShares.Contract.Destroy': 'Neo.Contract.Destroy',
  'AntShares.Storage.Put': 'Neo.Storage.Put',
  'AntShares.Storage.Delete': 'Neo.Storage.Delete',
};

const SYS_CALL_STRING_LENGTH = 252;

export const lookupSysCall = ({
  context,
}: {|
  context: ExecutionContext,
|}) => {
  const { code, pc } = context;
  const reader = new BinaryReader(code, pc);

  const sysCallBytes = reader.readVarBytesLE(SYS_CALL_STRING_LENGTH);
  const sysCallName = utils.toASCII(sysCallBytes);
  const canonicalName =
    SYSCALL_ALIASES[(sysCallName: $FlowFixMe)] || sysCallName;
  const createCall = SYSCALLS[(canonicalName: $FlowFixMe)];
  if (createCall == null) {
    throw new UnknownSysCallError(context, sysCallName);
  }

  const nextContext = {
    ...context,
    pc: reader.index,
  };
  return createCall({ context: nextContext });
};
