/* @flow */
import {
  type BlockKey,
  type DeserializeWireContext,
  type HeaderKey,
  type Output,
  type OutputKey,
  type UInt256,
  Account,
  Asset,
  Block,
  Contract,
  Header,
  InvocationData,
  StorageItem,
  Validator,
  deserializeActionWire,
  deserializeTransactionWire,
} from 'neo-blockchain-core';
import {
  type ChangeSet,
  type Storage,
  BlockSystemFee,
  TransactionSpentCoins,
} from 'neo-blockchain-node-core';

import { type LevelUp } from './types';
import { KeyNotFoundError } from './errors';

import * as common from './common';
import convertChange from './convertChange';
import * as keys from './keys';
import * as read from './read';

export default ({
  db,
  context,
}: {|
  db: LevelUp,
  context: DeserializeWireContext,
|}): Storage => {
  const getHash = async ({ hashOrIndex }: HeaderKey): Promise<UInt256> => {
    let hash = hashOrIndex;
    if (typeof hash === 'number') {
      try {
        const result = await db.get(keys.serializeHeaderIndexHashKey(hash));
        hash = common.deserializeHeaderHash(result);
      } catch (error) {
        if (error.notFound) {
          throw new KeyNotFoundError(`${(hash: $FlowFixMe)}`);
        }
        throw error;
      }
    }

    return hash;
  };

  const headerBase = read.createReadStorage({
    db,
    serializeKey: keys.typeKeyToSerializeKey.header,
    serializeKeyString: keys.typeKeyToSerializeKeyString.header,
    deserializeValue: (buffer: Buffer) =>
      Header.deserializeWire({
        context,
        buffer,
      }),
  });

  const getHeader = async ({ hashOrIndex }: HeaderKey): Promise<Header> => {
    const hash = await getHash({ hashOrIndex });
    return headerBase.get({ hash });
  };

  const header = {
    get: getHeader,
    tryGet: read.createTryGet({ get: getHeader }),
    tryGetLatest: read.createTryGetLatest({
      db,
      latestKey: keys.maxHeaderHashKey,
      deserializeResult: result => ({
        hash: common.deserializeHeaderHash(result),
      }),
      get: headerBase.get,
    }),
  };

  const blockBase = read.createReadStorage({
    db,
    serializeKey: keys.typeKeyToSerializeKey.block,
    serializeKeyString: keys.typeKeyToSerializeKeyString.block,
    deserializeValue: (buffer: Buffer) =>
      Block.deserializeWire({
        context,
        buffer,
      }),
  });

  const getBlock = async ({ hashOrIndex }: BlockKey): Promise<Block> => {
    const hash = await getHash({ hashOrIndex });
    return blockBase.get({ hash });
  };

  const block = {
    get: getBlock,
    tryGet: read.createTryGet({ get: getBlock }),
    tryGetLatest: read.createTryGetLatest({
      db,
      latestKey: keys.maxBlockHashKey,
      deserializeResult: result => ({
        hash: common.deserializeBlockHash(result),
      }),
      get: blockBase.get,
    }),
  };

  const transaction = read.createReadStorage({
    db,
    serializeKey: keys.typeKeyToSerializeKey.transaction,
    serializeKeyString: keys.typeKeyToSerializeKeyString.transaction,
    deserializeValue: (buffer: Buffer) =>
      deserializeTransactionWire({
        context,
        buffer,
      }),
  });

  const getOutput = async ({ index, hash }: OutputKey): Promise<Output> => {
    const tx = await transaction.get({ hash });
    const output = tx.outputs[index];
    if (output == null) {
      throw new KeyNotFoundError(
        keys.serializeOutputKeyString({ index, hash }),
      );
    }
    return output;
  };

  const output = {
    get: getOutput,
    tryGet: read.createTryGet({ get: getOutput }),
  };

  return {
    header,
    block,
    blockSystemFee: read.createReadStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.blockSystemFee,
      serializeKeyString: keys.typeKeyToSerializeKeyString.blockSystemFee,
      deserializeValue: (buffer: Buffer) =>
        BlockSystemFee.deserializeWire({
          context,
          buffer,
        }),
    }),
    account: read.createReadAllStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.account,
      serializeKeyString: keys.typeKeyToSerializeKeyString.account,
      minKey: keys.accountMinKey,
      maxKey: keys.accountMaxKey,
      deserializeValue: (buffer: Buffer) =>
        Account.deserializeWire({
          context,
          buffer,
        }),
    }),
    action: read.createReadGetAllStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.action,
      serializeKeyString: keys.typeKeyToSerializeKeyString.action,
      getMinKey: keys.getActionKeyMin,
      getMaxKey: keys.getActionKeyMax,
      deserializeValue: (buffer: Buffer) =>
        deserializeActionWire({
          context,
          buffer,
        }),
    }),
    asset: read.createReadStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.asset,
      serializeKeyString: keys.typeKeyToSerializeKeyString.asset,
      deserializeValue: (buffer: Buffer) =>
        Asset.deserializeWire({
          context,
          buffer,
        }),
    }),
    transaction,
    transactionSpentCoins: read.createReadStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.transactionSpentCoins,
      serializeKeyString:
        keys.typeKeyToSerializeKeyString.transactionSpentCoins,
      deserializeValue: (buffer: Buffer) =>
        TransactionSpentCoins.deserializeWire({ context, buffer }),
    }),
    output,
    contract: read.createReadStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.contract,
      serializeKeyString: keys.typeKeyToSerializeKeyString.contract,
      deserializeValue: (buffer: Buffer) =>
        Contract.deserializeWire({
          context,
          buffer,
        }),
    }),
    storageItem: read.createReadGetAllStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.storageItem,
      serializeKeyString: keys.typeKeyToSerializeKeyString.storageItem,
      getMinKey: keys.getStorageItemKeyMin,
      getMaxKey: keys.getStorageItemKeyMax,
      deserializeValue: (buffer: Buffer) =>
        StorageItem.deserializeWire({
          context,
          buffer,
        }),
    }),
    validator: read.createReadAllStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.validator,
      serializeKeyString: keys.typeKeyToSerializeKeyString.validator,
      minKey: keys.validatorMinKey,
      maxKey: keys.validatorMaxKey,
      deserializeValue: (buffer: Buffer) =>
        Validator.deserializeWire({
          context,
          buffer,
        }),
    }),
    invocationData: read.createReadStorage({
      db,
      serializeKey: keys.typeKeyToSerializeKey.invocationData,
      serializeKeyString: keys.typeKeyToSerializeKeyString.invocationData,
      deserializeValue: (buffer: Buffer) =>
        InvocationData.deserializeWire({
          context,
          buffer,
        }),
    }),
    async close(): Promise<void> {
      await db.close();
    },
    async commit(changeSet: ChangeSet): Promise<void> {
      const changesList = changeSet.map(change => convertChange(change));
      const changes = changesList.reduce((acc, converted) => {
        acc.push(...converted);
        return acc;
      }, []);
      await db.batch(changes);
    },
  };
};
