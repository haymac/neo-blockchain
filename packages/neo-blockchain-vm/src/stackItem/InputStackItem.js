/* @flow */
import type { Input } from 'neo-blockchain-core';

import ObjectStackItem from './ObjectStackItem';

export default class InputStackItem extends ObjectStackItem<Input> {
  asInput(): Input {
    return this.value;
  }
}
