/* @flow */
import {
  type OutputKey,
  type ActionKey,
  type ActionsKey,
  type StorageItemKey,
  type StorageItemsKey,
  type UInt160,
  type UInt256,
  type ValidatorKey,
  common,
} from 'neo-blockchain-core';

import bytewise from 'bytewise';

const accountKeyPrefix = 'account';
const actionKeyPrefix = 'action';
const assetKeyPrefix = 'asset';
const blockKeyPrefix = 'block';
const blockSystemFeeKeyPrefix = 'blockSystemFee';
const headerKeyPrefix = 'header';
const headerHashKeyPrefix = 'header-index';
const transactionKeyPrefix = 'transaction';
const outputKeyPrefix = 'output';
const transactionSpentCoinsKeyPrefix = 'transactionSpentCoins';
const contractKeyPrefix = 'contract';
const storageItemKeyPrefix = 'storageItem';
const validatorKeyPrefix = 'validator';
const invocationDataKeyPrefix = 'invocationData';
const settingsPrefix = 'settings';

export const serializeHeaderIndexHashKey = (index: number): Buffer =>
  bytewise.encode([headerHashKeyPrefix, index]);
export const serializeHeaderIndexHashKeyString = (index: number): string =>
  `${headerHashKeyPrefix}:${index}`;

export const maxHeaderHashKey = (bytewise.encode([
  settingsPrefix,
  'max-header-hash',
]): Buffer);
export const maxBlockHashKey = (bytewise.encode([
  settingsPrefix,
  'max-block-hash',
]): Buffer);

const serializeStorageItemKey = ({ hash, key }: StorageItemKey): Buffer =>
  bytewise.encode([storageItemKeyPrefix, common.uInt160ToBuffer(hash), key]);
const serializeStorageItemKeyString = ({ hash, key }: StorageItemKey): string =>
  `${storageItemKeyPrefix}:` +
  `${common.uInt160ToString(hash)}:` +
  `${key.toString('hex')}`;
export const getStorageItemKeyMin = ({ hash }: StorageItemsKey): Buffer =>
  bytewise.encode(
    hash == null
      ? bytewise.sorts.array.bound.lower([storageItemKeyPrefix])
      : bytewise.sorts.array.bound.lower([
          storageItemKeyPrefix,
          common.uInt160ToBuffer(hash),
        ]),
  );
export const getStorageItemKeyMax = ({ hash }: StorageItemsKey): Buffer =>
  bytewise.encode(
    hash == null
      ? bytewise.sorts.array.bound.upper([storageItemKeyPrefix])
      : bytewise.sorts.array.bound.upper([
          storageItemKeyPrefix,
          common.uInt160ToBuffer(hash),
        ]),
  );

export const serializeActionKey = ({
  blockIndex,
  transactionIndex,
  index,
}: ActionKey): Buffer =>
  bytewise.encode([actionKeyPrefix, blockIndex, transactionIndex, index]);
export const serializeActionKeyString = ({
  blockIndex,
  transactionIndex,
  index,
}: ActionKey): string =>
  `${actionKeyPrefix}:` +
  `${blockIndex}:` +
  `${transactionIndex}:` +
  `${index}`;
export const getActionKeyMin = ({
  blockIndexStart,
  transactionIndexStart,
  indexStart,
}: ActionsKey): Buffer =>
  bytewise.encode(
    bytewise.sorts.array.bound.lower(
      [
        actionKeyPrefix,
        blockIndexStart,
        transactionIndexStart,
        indexStart,
      ].filter(value => value != null),
    ),
  );
export const getActionKeyMax = ({
  blockIndexStop,
  transactionIndexStop,
  indexStop,
}: ActionsKey): Buffer =>
  bytewise.encode(
    bytewise.sorts.array.bound.upper([
      actionKeyPrefix,
      blockIndexStop == null ? Number.MAX_SAFE_INTEGER : blockIndexStop,
      transactionIndexStop == null
        ? Number.MAX_SAFE_INTEGER
        : transactionIndexStop,
      indexStop == null ? Number.MAX_SAFE_INTEGER : indexStop,
    ]),
  );

const serializeValidatorKey = ({ publicKey }: ValidatorKey): Buffer =>
  bytewise.encode([validatorKeyPrefix, common.ecPointToBuffer(publicKey)]);
const serializeValidatorKeyString = ({ publicKey }: ValidatorKey): string =>
  `${validatorKeyPrefix}:${common.ecPointToString(publicKey)}`;
export const validatorMinKey = bytewise.encode(
  bytewise.sorts.array.bound.lower([validatorKeyPrefix]),
);
export const validatorMaxKey = bytewise.encode(
  bytewise.sorts.array.bound.upper([validatorKeyPrefix]),
);

const serializeUInt160Key = ({ hash }: { +hash: UInt160 }): Buffer =>
  common.uInt160ToBuffer(hash);
const serializeUInt256Key = ({ hash }: { +hash: UInt256 }): Buffer =>
  common.uInt256ToBuffer(hash);

const createSerializeUInt160Key = (prefix: string) => (input: {
  +hash: UInt160,
}): Buffer => bytewise.encode([prefix, serializeUInt160Key(input)]);
const createSerializeUInt256Key = (prefix: string) => (input: {
  +hash: UInt256,
}): Buffer => bytewise.encode([prefix, serializeUInt256Key(input)]);

const createSerializeUInt160KeyString = (prefix: string) => (input: {
  +hash: UInt160,
}): string => `${prefix}:${common.uInt160ToString(input.hash)}`;
const createSerializeUInt256KeyString = (prefix: string) => (input: {
  +hash: UInt256,
}): string => `${prefix}:${common.uInt256ToString(input.hash)}`;

export const accountMinKey = bytewise.encode(
  bytewise.sorts.array.bound.lower([accountKeyPrefix]),
);
export const accountMaxKey = bytewise.encode(
  bytewise.sorts.array.bound.upper([accountKeyPrefix]),
);

const serializeOutputKey = ({ index, hash }: OutputKey): Buffer =>
  bytewise.encode([outputKeyPrefix, serializeUInt256Key({ hash }), index]);
const serializeOutputKeyString = ({ index, hash }: OutputKey): string =>
  `${outputKeyPrefix}:${common.uInt256ToString(hash)}:${index}`;

export const typeKeyToSerializeKey = {
  account: createSerializeUInt160Key(accountKeyPrefix),
  action: serializeActionKey,
  asset: createSerializeUInt256Key(assetKeyPrefix),
  block: createSerializeUInt256Key(blockKeyPrefix),
  blockSystemFee: createSerializeUInt256Key(blockSystemFeeKeyPrefix),
  header: createSerializeUInt256Key(headerKeyPrefix),
  transaction: createSerializeUInt256Key(transactionKeyPrefix),
  output: serializeOutputKey,
  transactionSpentCoins: createSerializeUInt256Key(
    transactionSpentCoinsKeyPrefix,
  ),
  contract: createSerializeUInt160Key(contractKeyPrefix),
  storageItem: serializeStorageItemKey,
  validator: serializeValidatorKey,
  invocationData: createSerializeUInt256Key(invocationDataKeyPrefix),
};

export const typeKeyToSerializeKeyString = {
  account: createSerializeUInt160KeyString(accountKeyPrefix),
  action: serializeActionKeyString,
  asset: createSerializeUInt256KeyString(assetKeyPrefix),
  block: createSerializeUInt256KeyString(blockKeyPrefix),
  blockSystemFee: createSerializeUInt256KeyString(blockSystemFeeKeyPrefix),
  header: createSerializeUInt256KeyString(headerKeyPrefix),
  transaction: createSerializeUInt256KeyString(transactionKeyPrefix),
  output: serializeOutputKeyString,
  transactionSpentCoins: createSerializeUInt256KeyString(
    transactionSpentCoinsKeyPrefix,
  ),
  contract: createSerializeUInt160KeyString(contractKeyPrefix),
  storageItem: serializeStorageItemKeyString,
  validator: serializeValidatorKeyString,
  invocationData: createSerializeUInt256KeyString(invocationDataKeyPrefix),
};
