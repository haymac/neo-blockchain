/* @flow */
export const TRANSACTION_TYPE = {
  MINER: 0x00,
  ISSUE: 0x01,
  CLAIM: 0x02,
  ENROLLMENT: 0x20,
  REGISTER: 0x40,
  CONTRACT: 0x80,
  PUBLISH: 0xd0,
  INVOCATION: 0xd1,
};

export class InvalidTransactionTypeError extends Error {
  transactionType: number;

  constructor(transactionType: number) {
    super(`Expected transaction type, found: ${transactionType.toString(16)}`);
    this.transactionType = transactionType;
  }
}

export type TransactionType =
  0x00 |
  0x01 |
  0x02 |
  0x20 |
  0x40 |
  0x80 |
  0xd0 |
  0xd1;

export const assertTransactionType = (
  value: number,
): TransactionType => {
  switch (value) {
    case 0x00: // Miner
      return 0x00;
    case 0x01: // Issue
      return 0x01;
    case 0x02: // Claim
      return 0x02;
    case 0x20: // Enrollment
      return 0x20;
    case 0x40: // Register
      return 0x40;
    case 0x80: // Contract
      return 0x80;
    case 0xd0: // Publish
      return 0xd0;
    case 0xd1 : // Invocation
      return 0xd1;
    default:
      throw new InvalidTransactionTypeError(value);
  }
};
