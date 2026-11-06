'use strict'

import { describe, it, expect, beforeEach, jest } from '@jest/globals'

import AptosRpc from '../src/aptos-rpc.js'

const RPC_URL = 'https://mock-aptos.test/v1'

describe('AptosRpc', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      text: async () => '{"hash":"0x01"}'
    })
  })

  describe('post', () => {
    it('should send the body with an explicit content-length, its utf-8 byte length', async () => {
      const rpc = new AptosRpc(RPC_URL)
      const body = { payload: 'ascii', note: 'é€😀' }

      await rpc.submitTransaction(body)

      const [url, options] = globalThis.fetch.mock.calls[0]
      expect(url).toBe(`${RPC_URL}/transactions`)
      expect(options.method).toBe('POST')
      expect(options.body).toBe(JSON.stringify(body))
      expect(options.headers['content-type']).toBe('application/json')
      expect(options.headers['content-length']).toBe(String(Buffer.byteLength(options.body, 'utf8')))
    })
  })
})
