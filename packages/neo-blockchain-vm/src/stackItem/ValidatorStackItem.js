/* @flow */
import type { Validator } from 'neo-blockchain-core';

import ObjectStackItem from './ObjectStackItem';

export default class ValidatorStackItem extends ObjectStackItem<Validator> {
  asValidator(): Validator {
    return this.value;
  }
}
