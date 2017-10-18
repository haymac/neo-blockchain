/* @flow */
export const INVENTORY_TYPE = {
  TRANSACTION: 0x01,
  BLOCK: 0x02,
  CONSENSUS: 0xe0,
};
export type InventoryType =
  0x01 |
  0x02 |
  0xe0;

export class InvalidInventoryTypeError extends Error {
  inventoryType: number;

  constructor(inventoryType: number) {
    super(`Expected inventory type, found: ${inventoryType}`);
    this.inventoryType = inventoryType;
  }
}

export const assertInventoryType = (inventoryType: number): InventoryType => {
  switch (inventoryType) {
    case INVENTORY_TYPE.TRANSACTION:
      return INVENTORY_TYPE.TRANSACTION;
    case INVENTORY_TYPE.BLOCK:
      return INVENTORY_TYPE.BLOCK;
    case INVENTORY_TYPE.CONSENSUS:
      return INVENTORY_TYPE.CONSENSUS;
    default:
      throw new InvalidInventoryTypeError(inventoryType);
  }
};
