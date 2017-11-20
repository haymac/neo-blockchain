/* @flow */
import {
  type AddChange,
  type Change,
  type DeleteChange,
} from 'neo-blockchain-node-core';

import { type LevelUpChange } from './types';
import { UnknownTypeError } from './errors';

import * as common from './common';
import * as keys from './keys';

const convertAddChange = (change: AddChange): Array<LevelUpChange> => {
  switch (change.type) {
    case 'account':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.account(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'action':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.action({
            blockIndex: change.value.blockIndex,
            transactionIndex: change.value.transactionIndex,
            index: change.value.index,
          }),
          value: change.value.serializeWire(),
        },
      ];
    case 'asset':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.asset(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'block':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.block(change.value),
          value: change.value.serializeWire(),
        },
        {
          type: 'put',
          key: keys.maxBlockHashKey,
          value: common.serializeBlockHash(change.value.hash),
        },
      ];
    case 'blockSystemFee':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.blockSystemFee(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'header':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.header(change.value),
          value: change.value.serializeWire(),
        },
        {
          type: 'put',
          key: keys.maxHeaderHashKey,
          value: common.serializeHeaderHash(change.value.hash),
        },
        {
          type: 'put',
          key: keys.serializeHeaderIndexHashKey(change.value.index),
          value: common.serializeHeaderHash(change.value.hash),
        },
      ];
    case 'transaction':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.transaction(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'transactionSpentCoins':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.transactionSpentCoins(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'contract':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.contract(change.value),
          value: change.value.serializeWire(),
        },
      ];
    case 'storageItem':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.storageItem({
            hash: change.value.hash,
            key: change.value.key,
          }),
          value: change.value.serializeWire(),
        },
      ];
    case 'validator':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.validator({
            publicKey: change.value.publicKey,
          }),
          value: change.value.serializeWire(),
        },
      ];
    case 'invocationData':
      return [
        {
          type: 'put',
          key: keys.typeKeyToSerializeKey.invocationData(change.value),
          value: change.value.serializeWire(),
        },
      ];
    default:
      // eslint-disable-next-line
      (change.type: empty);
      throw new UnknownTypeError();
  }
};

const convertDeleteChange = (change: DeleteChange): LevelUpChange => {
  switch (change.type) {
    case 'account':
      return {
        type: 'del',
        key: keys.typeKeyToSerializeKey.account(change.key),
      };
    case 'contract':
      return {
        type: 'del',
        key: keys.typeKeyToSerializeKey.contract(change.key),
      };
    case 'storageItem':
      return {
        type: 'del',
        key: keys.typeKeyToSerializeKey.storageItem(change.key),
      };
    default:
      // eslint-disable-next-line
      (change.type: empty);
      throw new UnknownTypeError();
  }
};

export default (change: Change): Array<LevelUpChange> => {
  if (change.type === 'add') {
    return convertAddChange(change.change);
  } else if (change.type === 'delete') {
    return [convertDeleteChange(change.change)];
  }

  // eslint-disable-next-line
  (change.type: empty);
  // TODO: Make better
  throw new Error('Bad change type');
};
