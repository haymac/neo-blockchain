/* @flow */
export const ACTION_TYPE = {
  LOG: 0x00,
  NOTIFICATION: 0x01,
};
export type ActionType =
  0x00 |
  0x01;

export class InvalidActionTypeError extends Error {
  type: number;

  constructor(type: number) {
    super(`Expected action type, found: ${type}`);
    this.type = type;
  }
}

export const assertActionType = (value: number): ActionType => {
  switch (value) {
    case ACTION_TYPE.LOG:
      return ACTION_TYPE.LOG;
    case ACTION_TYPE.NOTIFICATION:
      return ACTION_TYPE.NOTIFICATION;
    default:
      throw new InvalidActionTypeError(value);
  }
}
