// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import FailoverProvider from '@tetherto/wdk-failover-provider'

/**
 * @typedef {Object} AptosAccountData
 * @property {string} sequence_number - The account's sequence number.
 * @property {string} authentication_key - The account's authentication key.
 */

/**
 * @typedef {Object} AptosLedgerInfo
 * @property {string} chain_id - The chain id.
 * @property {string} ledger_version - The current ledger version.
 * @property {string} ledger_timestamp - The current ledger timestamp (microseconds).
 */

/**
 * The result of a transaction simulation.
 *
 * @typedef {Object} AptosSimulationResult
 * @property {boolean} success - Whether the simulated execution succeeded.
 * @property {string} vm_status - The VM status message.
 * @property {string} gas_used - The gas units consumed.
 * @property {string} gas_unit_price - The gas unit price (in octas).
 */

/**
 * A transaction as returned by the fullnode REST API. `type` is
 * "pending_transaction" while in the mempool and "user_transaction" once
 * committed; `success` and `vm_status` are present only once committed.
 *
 * @typedef {Object} AptosTransaction
 * @property {string} type - The transaction state.
 * @property {string} hash - The transaction hash.
 * @property {boolean} [success] - Whether execution succeeded (present once committed).
 * @property {string} [vm_status] - The VM status message (present once committed).
 */

/**
 * @typedef {Object} AptosRpcOptions
 * @property {number} [retries] - The number of failover retry attempts when the provider is a list of urls (default: 3).
 */

/**
 * @typedef {Object} AptosGetOptions
 * @property {boolean} [allow404] - When true, a 404 response resolves to null instead of throwing.
 * @property {boolean} [raw] - When true, the unparsed response text is returned instead of parsed JSON (required for bare-integer endpoints such as balances).
 */

/**
 * @typedef {Object} SignedTransactionPayload
 * @property {string} type - The payload type (e.g. "entry_function_payload").
 * @property {string} function - The fully-qualified entry function.
 * @property {string[]} type_arguments - The type arguments.
 * @property {string[]} arguments - The function arguments.
 */

/**
 * @typedef {Object} SignedTransactionSignature
 * @property {string} type - The signature scheme (e.g. "ed25519_signature").
 * @property {string} public_key - The signer's public key (hex).
 * @property {string} signature - The signature (hex).
 */

/**
 * A signed transaction in the JSON form accepted by the Aptos REST API.
 *
 * @typedef {Object} SignedTransaction
 * @property {string} sender - The sender's address.
 * @property {string} sequence_number - The sender's sequence number.
 * @property {string} max_gas_amount - The maximum gas units.
 * @property {string} gas_unit_price - The gas unit price (in octas).
 * @property {string} expiration_timestamp_secs - The expiration timestamp (in seconds).
 * @property {SignedTransactionPayload} payload - The transaction payload.
 * @property {SignedTransactionSignature} signature - The signature.
 */

/**
 * A thin client over the Aptos fullnode REST API (`/v1`).
 *
 * Uses the global `fetch` rather than the Aptos SDK's HTTP client so the
 * module stays Bare-runtime compatible (the SDK eagerly imports `undici`,
 * which Bare does not provide).
 */
export default class AptosRpc {
  /**
   * Creates a new Aptos REST client.
   *
   * @param {string | string[]} provider - The fullnode REST URL (e.g. "https://fullnode.mainnet.aptoslabs.com/v1"). An array enables failover across multiple urls.
   * @param {AptosRpcOptions} [options] - The options.
   */
  constructor (provider, { retries = 3 } = {}) {
    if (Array.isArray(provider)) {
      // Only fail over on transient failures: network errors (no HTTP status)
      // and 5xx. A 4xx is a deterministic client error that every provider will
      // reject identically, so retrying it just amplifies latency and load.
      const shouldRetryOn = (error) => {
        if (!(error instanceof Error)) {
          return false
        }

        return typeof error.status !== 'number' || error.status >= 500
      }

      const failover = new FailoverProvider({ retries, shouldRetryOn })

      for (const url of provider) {
        failover.addProvider(new SingleAptosRpc(url))
      }

      /** @private */
      this._client = failover.initialize()
    } else {
      /** @private */
      this._client = new SingleAptosRpc(provider)
    }
  }

  /**
   * Returns the ledger info (chain id, ledger version, etc.).
   *
   * @returns {Promise<AptosLedgerInfo>} The ledger info.
   */
  async getLedgerInfo () {
    return this._client.get('')
  }

  /**
   * Returns the on-chain data for an account, or null if the account has not
   * been created yet.
   *
   * @param {string} address - The account address.
   * @returns {Promise<AptosAccountData | null>} The account data, or null.
   */
  async getAccount (address) {
    return this._client.get(`/accounts/${address}`, { allow404: true })
  }

  /**
   * Returns the balance of an asset for an account. Accepts either a coin type
   * tag (e.g. "0x1::aptos_coin::AptosCoin") or a fungible asset metadata
   * address (e.g. "0xa"). Returns 0n when the account or store does not exist.
   *
   * @param {string} address - The account address.
   * @param {string} assetType - The coin type tag or fungible asset metadata address.
   * @returns {Promise<bigint>} The balance (in base units).
   */
  async getBalance (address, assetType) {
    // `raw` keeps the bare integer as a string: balances can exceed the
    // safe-integer range, and JSON.parse would silently round them to a float.
    const value = await this._client.get(`/accounts/${address}/balance/${encodeURIComponent(assetType)}`, { allow404: true, raw: true })

    if (value === null) {
      return 0n
    }

    try {
      return BigInt(value.trim())
    } catch {
      throw new Error(`Unexpected balance response for asset ${assetType}: ${value}.`)
    }
  }

  /**
   * Returns the current gas price estimate.
   *
   * @returns {Promise<{ gas_estimate: number, deprioritized_gas_estimate?: number, prioritized_gas_estimate?: number }>} The estimate.
   */
  async estimateGasPrice () {
    return this._client.get('/estimate_gas_price')
  }

  /**
   * Simulates a transaction without submitting it. The transaction's signature
   * must be a zero signature (the VM derives the authentication key from the
   * public key but does not verify the signature for simulations).
   *
   * @param {SignedTransaction} signedTransaction - The signed transaction (JSON form).
   * @returns {Promise<AptosSimulationResult>} The simulation result.
   */
  async simulateTransaction (signedTransaction) {
    const [result] = await this._client.post('/transactions/simulate', signedTransaction)

    return result
  }

  /**
   * Submits a signed transaction.
   *
   * @param {SignedTransaction} signedTransaction - The signed transaction (JSON form).
   * @returns {Promise<{ hash: string }>} The pending transaction.
   */
  async submitTransaction (signedTransaction) {
    return this._client.post('/transactions', signedTransaction)
  }

  /**
   * Returns a transaction by its hash, or null if it has not been committed yet.
   *
   * @param {string} hash - The transaction hash.
   * @returns {Promise<AptosTransaction | null>} The transaction, or null.
   */
  async getTransactionByHash (hash) {
    return this._client.get(`/transactions/by_hash/${hash}`, { allow404: true })
  }
}

/**
 * Returns the length in bytes of the UTF-8 encoding of a string, without Buffer or
 * TextEncoder, so it works on both Node.js and Bare.
 *
 * @param {string} value - The string.
 * @returns {number} The byte length.
 */
function utf8ByteLength (value) {
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}/g, 'x').length
}

/**
 * A single-endpoint Aptos REST client. Wrapped by {@link AptosRpc} which may
 * stack several of these behind a {@link FailoverProvider}.
 *
 * @private
 */
class SingleAptosRpc {
  constructor (baseUrl) {
    /** @private */
    this._baseUrl = baseUrl.replace(/\/$/, '')
  }

  /**
   * Performs a GET request against the endpoint.
   *
   * @param {string} path - The path appended to the base url.
   * @param {AptosGetOptions} [options] - The options.
   * @returns {Promise<unknown>} The parsed response, or null on a tolerated 404.
   */
  async get (path, { allow404 = false, raw = false } = {}) {
    const res = await fetch(`${this._baseUrl}${path}`)

    if (allow404 && res.status === 404) {
      return null
    }

    return this._parse(res, raw)
  }

  /**
   * Performs a JSON POST request against the endpoint.
   *
   * @param {string} path - The path appended to the base url.
   * @param {unknown} body - The request body, serialized as JSON.
   * @returns {Promise<unknown>} The parsed response.
   */
  async post (path, body) {
    const json = JSON.stringify(body)

    const res = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      // An explicit content-length: without it, some fetch implementations (e.g. bare-fetch
      // in the Bare runtime) send the body chunked, which the Aptos Labs fullnode rejects with
      // "400 - Transfer-Encoding is not supported".
      headers: { 'content-type': 'application/json', 'content-length': String(utf8ByteLength(json)) },
      body: json
    })

    return this._parse(res)
  }

  /**
   * Parses a fetch response. On error, throws with the API message. On success,
   * returns the parsed JSON — unless `raw` is set, in which case the unparsed
   * response text is returned. `raw` is required for endpoints that return a
   * bare integer (e.g. balances), whose magnitude can exceed the safe-integer
   * range that `JSON.parse` would silently round.
   *
   * @private
   * @param {Response} res - The fetch response.
   * @param {boolean} [raw] - When true, return the unparsed text on success.
   * @returns {Promise<unknown>} The parsed response, or the raw text when `raw`.
   */
  async _parse (res, raw = false) {
    const text = await res.text()

    if (!res.ok) {
      let message = res.statusText
      try {
        const data = text ? JSON.parse(text) : null
        if (data && data.message) {
          message = data.message
        }
      } catch {
        // Non-JSON error body; fall back to the status text.
      }

      const error = new Error(`Aptos RPC request failed: ${res.status} - ${message}`)
      error.status = res.status

      throw error
    }

    if (raw) {
      return text
    }

    try {
      return JSON.parse(text)
    } catch {
      // An empty body (text === '') also lands here; fall back to the raw text.
      return text
    }
  }
}
