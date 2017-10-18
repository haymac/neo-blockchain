/* @flow */
import type {
  BlockBase,
  Header,
} from 'neo-blockchain-core';

import ObjectStackItem from './ObjectStackItem';

export default class HeaderStackItem extends ObjectStackItem<Header> {
  asHeader(): Header {
    return this.value;
  }

  asBlockBase(): BlockBase {
    return this.value;
  }
}
