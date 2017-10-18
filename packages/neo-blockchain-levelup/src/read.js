/* @flow */
import { type Observable } from 'rxjs';
import {
  type ReadAllStorage,
  type ReadGetAllStorage,
  type ReadStorage,
} from 'neo-blockchain-node-core';

import { type LevelUp } from './types';
import { KeyNotFoundError } from './errors';

import streamToObservable from './streamToObservable';

type SerializeKey<Key> = (key: Key) => Buffer;
type SerializeKeyString<Key> = (key: Key) => string;

export function createTryGet<Key, Value>({
  get,
}: {|
  get: (key: Key) => Promise<Value>,
|}): (key: Key) => Promise<?Value> {
  return async (key: Key): Promise<?Value> => {
    try {
      const result = await get(key);
      return result
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  };
};

export function createTryGetLatest<Key, Value>({
  db,
  latestKey,
  deserializeResult,
  get,
}: {|
  db: LevelUp,
  latestKey: Buffer,
  deserializeResult: (latestResult: Buffer) => Key,
  get: (key: Key) => Promise<Value>,
|}): () => Promise<?Value> {
  return async (): Promise<?Value> => {
    try {
      const result = await db.get(latestKey);
      const value = await get(deserializeResult(result));
      return value;
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  };
};

export function createReadStorage<Key, Value>({
  db,
  serializeKey,
  serializeKeyString,
  deserializeValue,
}: {|
  db: LevelUp,
  serializeKey: SerializeKey<Key>,
  serializeKeyString: SerializeKeyString<Key>,
  deserializeValue: (value: Buffer) => Value,
|}): ReadStorage<Key, Value> {
  const get = async (key: Key): Promise<Value> => {
    try {
      const result = await db.get(serializeKey(key));
      return deserializeValue(result);
    } catch (error) {
      if (error.notFound) {
        throw new KeyNotFoundError(serializeKeyString(key));
      }

      throw error;
    }
  };

  return { get, tryGet: createTryGet({ get }) };
}

export function createAll<Value>({
  db,
  minKey,
  maxKey,
  deserializeValue,
}: {|
  db: LevelUp,
  minKey: Buffer,
  maxKey: Buffer,
  deserializeValue: (value: Buffer) => Value,
|}): Observable<Value> {
  return streamToObservable(() => db.createValueStream({
    gte: minKey,
    lte: maxKey,
  })).map(value => deserializeValue(value));
};

export function createReadAllStorage<Key, Value>({
  db,
  serializeKey,
  serializeKeyString,
  minKey,
  maxKey,
  deserializeValue,
}: {|
  db: LevelUp,
  serializeKey: SerializeKey<Key>,
  serializeKeyString: SerializeKeyString<Key>,
  minKey: Buffer,
  maxKey: Buffer,
  deserializeValue: (value: Buffer) => Value,
|}): ReadAllStorage<Key, Value> {
  const readStorage = createReadStorage({
    db,
    serializeKey,
    serializeKeyString,
    deserializeValue,
  });

  return {
    get: readStorage.get,
    tryGet: readStorage.tryGet,
    all: createAll({ db, minKey, maxKey, deserializeValue }),
  };
};

export function createReadGetAllStorage<Key, Keys, Value>({
  db,
  serializeKey,
  serializeKeyString,
  getMinKey,
  getMaxKey,
  deserializeValue,
}: {|
  db: LevelUp,
  serializeKey: SerializeKey<Key>,
  serializeKeyString: SerializeKeyString<Key>,
  getMinKey: (keys: Keys) => Buffer,
  getMaxKey: (keys: Keys) => Buffer,
  deserializeValue: (value: Buffer) => Value,
|}): ReadGetAllStorage<Key, Keys, Value> {
  const readStorage = createReadStorage({
    db,
    serializeKey,
    serializeKeyString,
    deserializeValue,
  });

  return {
    get: readStorage.get,
    tryGet: readStorage.tryGet,
    getAll: (keys: Keys) => createAll({
      db,
      minKey: getMinKey(keys),
      maxKey: getMaxKey(keys),
      deserializeValue,
    }),
  };
};
