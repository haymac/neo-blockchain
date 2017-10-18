/* @flow */
import type { Transaction, UInt256Hex } from 'neo-blockchain-core';

export interface Node {
  relayTransaction(transaction: Transaction): Promise<void>;
  +connectedPeersCount: number;
  +memPool: { [hash: UInt256Hex]: Transaction };
}
