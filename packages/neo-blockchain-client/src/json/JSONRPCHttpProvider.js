/* @flow */
import DataLoader from 'dataloader';

import fetch from 'isomorphic-fetch';

import {
  HTTPError,
  InvalidRPCResponseError,
  JSONRPCError,
} from './errors';
import { type JSONRPCRequest, type JSONRPCProvider } from './JSONRPCProvider';
import { UnknownBlockError } from '../errors';

// TODO: Needs to be significantly lower... but certain blocks currently
//       take a long time to respond
const TIMEOUT_MS = 20000;

const PARSE_ERROR_CODE = -32700;
const PARSE_ERROR_MESSAGE = 'Parse error';

export const request = async ({
  endpoint,
  requests,
  timeoutMS,
  tries: triesIn,
}: {|
  endpoint: string,
  requests: Array<Object>,
  timeoutMS?: number,
  tries?: number,
|}) => {
  const timeout = timeoutMS == null ? 5000 : timeoutMS;
  let tries = triesIn == null ? 0 : triesIn;
  let parseErrorTries = 3;
  let result;
  let finalError;
  while (tries >= 0) {
    try {
      // eslint-disable-next-line
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requests),
        timeout,
      });
      if (!response.ok) {
        let text = null;
        try {
          // eslint-disable-next-line
          text = await response.text();
        } catch (error) {
          // eslint-disable-next-line
        }
        throw new HTTPError(response.status, text);
      }
      // eslint-disable-next-line
      result = await response.json();
      if (!Array.isArray(result)) {
        if (
          result.error &&
          result.error.code === PARSE_ERROR_CODE &&
          result.error.message === PARSE_ERROR_MESSAGE &&
          parseErrorTries > 0
        ) {
          tries += 1;
          parseErrorTries -= 1;
        }
      } else {
        return result;
      }
    } catch (error) {
      finalError = error;
    }

    tries -= 1;
  }
  if (finalError != null) {
    throw finalError;
  }

  throw new InvalidRPCResponseError()
};

export const handleResponse = (responseJSON: Object): any => {
  if (responseJSON.error != null) {
    if (
      responseJSON.error.code === -100 &&
      responseJSON.error.message === 'Unknown block'
    ) {
      throw new UnknownBlockError();
    }
    throw new JSONRPCError(responseJSON.error);
  }

  return responseJSON.result;
}

export default class JSONRPCHttpProvider implements JSONRPCProvider {
  batcher: DataLoader<Object, Object>;

  constructor(endpoint: string) {
    this.batcher = new DataLoader(
      async (requests) => {
        const result = await request({
          endpoint,
          requests,
          tries: 1,
          timeoutMS: TIMEOUT_MS,
        });
        return result;
      },
      { maxBatchSize: 25, cache: false },
    );
  }

  async request(req: JSONRPCRequest): Promise<any> {
    const responseJSON = await this.batcher.load({
      jsonrpc: '2.0',
      id: 1,
      params: [],
      ...req,
    });
    return handleResponse(responseJSON);
  }
}
