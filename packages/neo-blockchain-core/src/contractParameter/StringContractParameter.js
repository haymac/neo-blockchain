/* @flow */
import { CONTRACT_PARAMETER_TYPE } from './ContractParameterType';
import ContractParameterBase from './ContractParameterBase';
import {
  type DeserializeWireBaseOptions,
  type SerializeJSONContext,
} from '../Serializable';

import { type BinaryWriter } from '../utils';

export type StringContractParameterJSON = {|
  type: 'String',
  value: string,
|}

export default class StringContractParameter extends ContractParameterBase<
  StringContractParameter,
  StringContractParameterJSON,
  typeof CONTRACT_PARAMETER_TYPE.STRING
> {
  type = CONTRACT_PARAMETER_TYPE.STRING;

  value: string;

  constructor(value: string) {
    super();
    this.value = value;
  }

  asBuffer(): Buffer {
    return Buffer.from(this.value, 'utf8');
  }

  serializeWireBase(writer: BinaryWriter): void {
    super.serializeWireBase(writer);
    writer.writeVarString(this.value);
  }

  static deserializeWireBase(
    options: DeserializeWireBaseOptions,
  ): this {
    const { reader } = options;
    super.deserializeContractParameterBaseWireBase(options);
    const value = reader.readVarString();

    return new this(value);
  }

  serializeJSON(
    // eslint-disable-next-line
    context: SerializeJSONContext,
  ): StringContractParameterJSON {
    return {
      type: 'String',
      value: this.value,
    };
  }
}
