/* @flow */
import BaseState from './BaseState';
import {
  type ContractParameterType,
  type ContractParameterTypeJSON,
  assertContractParameterType,
  toJSONContractParameterType,
} from './contractParameter';
import { type Equatable, type Equals } from './Equatable';
import {
  type DeserializeWireBaseOptions,
  type DeserializeWireOptions,
  type SerializeWire,
  type SerializableWire,
  type SerializeJSONContext,
  type SerializableJSON,
  createSerializeWire,
} from './Serializable';
import common, {
  type UInt160,
  type UInt160Hex,
} from './common';

import crypto from './crypto';
import utils, {
  BinaryReader,
  type BinaryWriter,
  IOHelper,
  JSONHelper,
} from './utils';

export type ContractKey = {| hash: UInt160 |};
export type ContractAdd = {|
  hash?: UInt160,
  version?: number,
  script: Buffer;
  parameterList: Array<ContractParameterType>;
  returnType: ContractParameterType;
  hasStorage: boolean;
  name: string;
  codeVersion: string;
  author: string;
  email: string;
  description: string;
|};

export type ContractJSON = {|
  version: number,
  code: {|
    hash: string,
    script: string,
    parameters: Array<ContractParameterTypeJSON>,
    returntype: ContractParameterTypeJSON,
  |},
  needstorage: boolean,
  name: string,
  code_version: string,
  author: string,
  email: string,
  description: string,
|};

export default class Contract extends BaseState
  implements SerializableWire<Contract>, SerializableJSON<ContractJSON>, Equatable {
  script: Buffer;
  parameterList: Array<ContractParameterType>;
  returnType: ContractParameterType;
  hasStorage: boolean;
  name: string;
  codeVersion: string;
  author: string;
  email: string;
  description: string;

  constructor({
    version,
    script,
    parameterList,
    returnType,
    hasStorage,
    name,
    codeVersion,
    author,
    email,
    description,
  }: ContractAdd) {
    super({ version });
    this.script = script;
    this.parameterList = parameterList;
    this.returnType = returnType;
    this.hasStorage = hasStorage;
    this.name = name;
    this.codeVersion = codeVersion;
    this.author = author;
    this.email = email;
    this.description = description;
  }

  // eslint-disable-next-line
  __contractSize = utils.lazy(() => sizeOfContract({
    script: this.script,
    parameterList: this.parameterList,
    name: this.name,
    codeVersion: this.codeVersion,
    author: this.author,
    email: this.email,
    description: this.description,
  }));

  get size(): number {
    return this.__contractSize();
  }

  _hash = utils.lazy(() => crypto.toScriptHash(this.script));

  get hash(): UInt160 {
    return this._hash();
  }

  _hashHex = utils.lazy(() => common.uInt160ToHex(this.hash));

  get hashHex(): UInt160Hex {
    return this._hashHex();
  }

  equals: Equals = utils.equals(
    Contract,
    (other) => common.uInt160Equal(this.hash, other.hash),
  );

  serializeWireBase(writer: BinaryWriter): void {
    // eslint-disable-next-line
    serializeContractWireBase({ writer, contract: this });
  }

  serializeWire: SerializeWire = createSerializeWire(this.serializeWireBase.bind(this));

  static deserializeWireBase(options: DeserializeWireBaseOptions): Contract {
    // eslint-disable-next-line
    return deserializeContractWireBase({
      context: options.context,
      reader: options.reader,
    });
  }

  static deserializeWire(options: DeserializeWireOptions): this {
    return this.deserializeWireBase({
      context: options.context,
      reader: new BinaryReader(options.buffer),
    });
  }

  // eslint-disable-next-line
  serializeJSON(context: SerializeJSONContext): ContractJSON {
    return {
      version: this.version,
      code: {
        hash: JSONHelper.writeUInt160(this.hash),
        script: JSONHelper.writeBuffer(this.script),
        parameters: this.parameterList.map(
          parameter => toJSONContractParameterType(parameter),
        ),
        returntype: toJSONContractParameterType(this.returnType),
      },
      needstorage: this.hasStorage,
      name: this.name,
      code_version: this.codeVersion,
      author: this.author,
      email: this.email,
      description: this.description,
    };
  }
}

export const sizeOfContract = ({
  script,
  parameterList,
  name,
  codeVersion,
  author,
  email,
  description,
  publishVersion,
}: {|
  script: Buffer,
  parameterList: Array<ContractParameterType>,
  name: string,
  codeVersion: string,
  author: string,
  email: string,
  description: string,
  publishVersion?: number,
|}) =>  (
  IOHelper.sizeOfVarBytesLE(script) +
  IOHelper.sizeOfVarBytesLE(Buffer.from(parameterList)) +
  IOHelper.sizeOfUInt8 +
  // TODO: Doesn't take version into account?
  (publishVersion == null ? IOHelper.sizeOfBoolean : 0) +
  IOHelper.sizeOfVarString(name) +
  IOHelper.sizeOfVarString(codeVersion) +
  IOHelper.sizeOfVarString(author) +
  IOHelper.sizeOfVarString(email) +
  IOHelper.sizeOfVarString(description)
);

export const deserializeContractWireBase = ({
  reader,
  publishVersion,
}: {|
  ...DeserializeWireBaseOptions,
  publishVersion?: number,
|}): Contract => {
  const script = reader.readVarBytesLE();
  const parameterList = [...reader.readVarBytesLE()].map(
    value => assertContractParameterType(value),
  );
  const returnType = assertContractParameterType(reader.readUInt8());
  const hasStorage = publishVersion == null || publishVersion >= 1
    ? reader.readBoolean()
    : false;
  const name = reader.readVarString(252);
  const codeVersion = reader.readVarString(252);
  const author = reader.readVarString(252);
  const email = reader.readVarString(252);
  const description = reader.readVarString(65536);

  return new Contract({
    script,
    parameterList,
    returnType,
    hasStorage,
    name,
    codeVersion,
    author,
    email,
    description,
  });
};

export const serializeContractWireBase = ({
  writer,
  contract,
  publishVersion,
}: {|
  writer: BinaryWriter,
  contract: Contract,
  publishVersion?: number,
|}): void => {
  writer.writeVarBytesLE(contract.script);
  writer.writeVarBytesLE(Buffer.from(contract.parameterList));
  writer.writeUInt8(contract.returnType);
  if (publishVersion == null || publishVersion >= 1) {
    writer.writeBoolean(contract.hasStorage);
  }
  writer.writeVarString(contract.name);
  writer.writeVarString(contract.codeVersion);
  writer.writeVarString(contract.author);
  writer.writeVarString(contract.email);
  writer.writeVarString(contract.description);
};
