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

import { WalletAccountReadOnly, NoSuchElementError, ValueError } from '@tetherto/wdk-wallet'

import { ed25519 } from '@noble/curves/ed25519'
// eslint-disable-next-line camelcase
import { sha3_256 } from '@noble/hashes/sha3'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'

import AptosRpc from './aptos-rpc.js'
import {
  encodeEntryFunctionPayload,
  encodeStructTypeTag,
  encodeAddressArg,
  encodeU64Arg
} from './transaction.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferOptions} TransferOptions */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */
/** @typedef {import('@tetherto/wdk-wallet').TransactionReceipt} TransactionReceipt */
/** @typedef {import('@tetherto/wdk-wallet').WaitForTransactionOptions} WaitForTransactionOptions */

/** @typedef {import('./aptos-rpc.js').AptosSimulationResult} AptosSimulationResult */

/**
 * @typedef {Object} AptosWalletConfig
 * @property {string | AptosRpc | Array<string>} [provider] - The Aptos fullnode REST url (e.g. "https://fullnode.mainnet.aptoslabs.com/v1"), or an already-built `AptosRpc` client. An array of urls enables failover. An already-built client is reused as-is, which lets a manager share a single client across all the accounts it creates.
 * @property {number} [chainId] - The chain id (mainnet: 1, testnet: 2). Fetched from the ledger info on first use if omitted.
 * @property {number} [retries] - The number of failover retry attempts if 'provider' is a list of urls (default: 3).
 * @property {number} [txnExpirationSecs] - The transaction expiration window in seconds from now (default: 60).
 * @property {number | bigint} [transferMaxFee] - The maximum allowed fee in octas for transfer operations.
 */

/**
 * @typedef {Object} AptosTransaction
 * @property {string} to - The recipient's address.
 * @property {number | bigint} value - The amount of APT to send (in octas, 1 APT = 100,000,000 octas).
 */

/**
 * @typedef {Object} EntryFunctionPayload
 * @property {string} function - The fully-qualified entry function (e.g. "0x1::aptos_account::transfer").
 * @property {string[]} type_arguments - The type arguments.
 * @property {string[]} arguments - The function arguments (addresses as hex, u64 amounts as decimal strings).
 */

/**
 * A committed or pending transaction as returned by the fullnode REST API.
 *
 * @typedef {Object} AptosTransactionReceipt
 * @property {string} type - The transaction state ("pending_transaction" or "user_transaction").
 * @property {string} hash - The transaction hash.
 * @property {boolean} [success] - Whether execution succeeded (present once committed).
 * @property {string} [vm_status] - The VM status message (present once committed).
 * @property {string} [version] - The ledger version the transaction was committed at (present once committed).
 * @property {string} [gas_used] - The gas units consumed (present once committed).
 * @property {string} [gas_unit_price] - The gas unit price in octas (present once committed).
 */

/**
 * A normalized Aptos transaction receipt, extended with the raw fullnode transaction object.
 *
 * @typedef {TransactionReceipt & {
 *   transaction: AptosTransactionReceipt
 * }} AptosTransactionInfo
 */

// The fungible asset metadata address of native APT.
const APT_METADATA_ADDRESS = '0xa'

// An Aptos transaction hash is a 0x-prefixed 32-byte (64 hex character) string.
const TRANSACTION_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

// The default transaction expiration window, in seconds.
const DEFAULT_TXN_EXPIRATION_SECS = 60

// The default maximum gas units used when simulating and submitting transactions.
const DEFAULT_MAX_GAS_AMOUNT = 100000n

/**
 * Read-only Aptos wallet account implementation.
 *
 * @implements {IWalletAccountReadOnly}
 */
export default class WalletAccountReadOnlyAptos extends WalletAccountReadOnly {
  /**
   * Creates a new aptos read-only wallet account.
   *
   * @param {string} address - The account's address.
   * @param {AptosWalletConfig} [config] - The configuration object.
   * @param {Uint8Array} [publicKey] - The account's Ed25519 public key (32 bytes). Required to verify signatures, since an Aptos address is a one-way hash of the public key and cannot recover it.
   */
  constructor (address, config = {}, publicKey) {
    super(address)

    // When a public key is supplied, ensure it matches the address (an Aptos
    // address is a one-way hash of the public key). This catches a malformed
    // (address, publicKey) pair early rather than at signature-verification time.
    if (publicKey && deriveAddress(publicKey) !== normalizeAddress(address)) {
      throw new Error('The public key does not match the account address.')
    }

    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {AptosWalletConfig}
     */
    this._config = config

    /**
     * The account's Ed25519 public key, if known. Set when the account is
     * derived from a seed (directly or via {@link toReadOnlyAccount}); absent
     * when the account is constructed from an address alone.
     *
     * @protected
     * @type {Uint8Array | undefined}
     */
    this._publicKey = publicKey

    /**
     * The Aptos REST client.
     *
     * @protected
     * @type {AptosRpc | undefined}
     */
    this._rpc = WalletAccountReadOnlyAptos._buildRpc(config)

    /**
     * The cached chain id.
     *
     * @private
     * @type {number | undefined}
     */
    this._chainId = config.chainId

    /**
     * The transaction expiration window, in seconds. Resolved once here rather
     * than recomputed on every transaction.
     *
     * @private
     * @type {number}
     */
    this._txnExpirationSecs = config.txnExpirationSecs ?? DEFAULT_TXN_EXPIRATION_SECS
  }

  /**
   * Builds the Aptos REST client from the wallet configuration: a url (or list of urls, for
   * failover), or an already-built `AptosRpc` reused as-is.
   *
   * @protected
   * @param {AptosWalletConfig} [config] - The configuration object.
   * @returns {AptosRpc | undefined} The rpc client, or undefined if none is configured.
   */
  static _buildRpc (config = {}) {
    const { provider, retries = 3 } = config

    if (provider instanceof AptosRpc) {
      return provider
    }

    // An empty provider array is truthy but has no endpoints, so guard against
    // it explicitly rather than constructing a failover with nothing to fail over to.
    const hasProvider = Array.isArray(provider) ? provider.length > 0 : Boolean(provider)

    return hasProvider ? new AptosRpc(provider, { retries }) : undefined
  }

  /**
   * Returns the account's native APT balance.
   *
   * @returns {Promise<bigint>} The APT balance (in octas).
   */
  async getBalance () {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to retrieve balances.')
    }

    const address = await this.getAddress()

    return this._rpc.getBalance(address, APT_METADATA_ADDRESS)
  }

  /**
   * Returns the account balance for a specific fungible asset.
   *
   * @param {string} tokenAddress - The fungible asset metadata address (e.g. the USDT metadata address).
   * @returns {Promise<bigint>} The token balance (in base units).
   */
  async getTokenBalance (tokenAddress) {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to retrieve token balances.')
    }

    const address = await this.getAddress()

    return this._rpc.getBalance(address, tokenAddress)
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {AptosTransaction} tx - The transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   */
  async quoteSendTransaction (tx) {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to quote transactions.')
    }

    return { fee: await this._simulateFee(this._buildNativeTransferPayload(tx.to, tx.value)) }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * @param {TransferOptions} options - The transfer's options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   */
  async quoteTransfer (options) {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to quote transfer operations.')
    }

    return { fee: await this._simulateFee(this._buildFungibleAssetTransferPayload(options.token, options.recipient, options.amount)) }
  }

  /**
   * Returns a transaction's receipt.
   *
   * The result distinguishes three states, so a caller polling for
   * confirmation must inspect it rather than only checking for non-null:
   * - `null` — the hash is unknown to the node (not yet propagated, or invalid).
   * - an object with `type: "pending_transaction"` — accepted into the mempool
   *   but not yet committed; it has no `success` or `vm_status` field.
   * - an object with `type: "user_transaction"` and a `success` boolean — committed;
   *   `success` indicates whether it executed successfully and `vm_status` carries the reason.
   *
   * @param {string} hash - The transaction's hash.
   * @returns {Promise<AptosTransactionReceipt | null>} The receipt, or null if the transaction is unknown to the node.
   */
  async getTransactionReceipt (hash) {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to fetch transaction receipts.')
    }

    return this._rpc.getTransactionByHash(hash)
  }

  /**
   * Returns a normalized, finality-based receipt for a transaction.
   *
   * An Aptos transaction is `pending` while in the mempool and `final` once
   * committed: consensus commits transactions irreversibly, so there is no
   * intermediate `confirmed` state.
   *
   * @param {string} hash - The transaction's hash.
   * @returns {Promise<AptosTransactionInfo>} The normalized receipt.
   * @throws {ValueError} If the hash is not a valid transaction hash.
   * @throws {NoSuchElementError} If no transaction has been found for the given hash.
   */
  async getTransaction (hash) {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to fetch transactions.')
    }

    if (typeof hash !== 'string' || !TRANSACTION_HASH_REGEX.test(hash.trim())) {
      throw new ValueError(`Invalid transaction hash: '${hash}'.`)
    }

    const normalizedHash = hash.trim()

    const transaction = await this._rpc.getTransactionByHash(normalizedHash)

    if (!transaction) {
      throw new NoSuchElementError(`No transaction found for hash '${normalizedHash}'.`)
    }

    const committed = transaction.type !== 'pending_transaction'

    return {
      hash: normalizedHash,
      finality: committed ? 'final' : 'pending',
      success: committed ? transaction.success : undefined,
      block: committed && transaction.version != null ? Number(transaction.version) : undefined,
      fee: committed && transaction.gas_used != null && transaction.gas_unit_price != null
        ? BigInt(transaction.gas_used) * BigInt(transaction.gas_unit_price)
        : undefined,
      transaction
    }
  }

  /**
   * Blocks until a transaction reaches a terminal state (the requested finality target or `dropped`), or times out.
   *
   * @param {string} hash - The transaction's hash.
   * @param {WaitForTransactionOptions} [options] - The wait options.
   * @returns {Promise<AptosTransactionInfo>} The terminal receipt: the finality target reached (inspect `success` to tell success from revert), or `dropped`.
   * @throws {TimeoutError} If the target is not reached before the timeout.
   */
  async waitForTransaction (hash, options = {}) {
    return await super.waitForTransaction(hash, options)
  }

  /**
   * Verifies a message's signature against this account's public key.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify (hex).
   * @returns {Promise<boolean>} True if the signature is valid.
   * @throws {Error} If the account's public key is unknown. An Aptos address is a one-way hash of the public key, so an account built from an address alone cannot verify signatures; derive it from a seed or obtain it via toReadOnlyAccount() instead.
   */
  async verify (message, signature) {
    if (!this._publicKey) {
      throw new Error('The public key is required to verify signatures. Derive the account from a seed instead of an address alone.')
    }

    // Accept signatures with or without a 0x prefix (the module's own
    // signTransaction and the Aptos SDK both emit 0x-prefixed hex), and treat
    // any malformed signature as simply invalid rather than throwing.
    let signatureBytes
    try {
      signatureBytes = hexToBytes(signature.startsWith('0x') ? signature.slice(2) : signature)
    } catch {
      return false
    }

    try {
      return ed25519.verify(signatureBytes, new TextEncoder().encode(message), this._publicKey)
    } catch {
      return false
    }
  }

  /**
   * Describes a native APT transfer via `0x1::aptos_account::transfer`, which
   * auto-creates the recipient's account if it does not exist.
   *
   * A payload descriptor is both the JSON form sent to the REST API and the
   * source the BCS bytes are derived from for signing.
   *
   * @protected
   * @param {string} recipient - The recipient's address.
   * @param {number | bigint} amount - The amount of APT to send (in octas).
   * @returns {EntryFunctionPayload} The payload descriptor.
   */
  _buildNativeTransferPayload (recipient, amount) {
    return {
      function: '0x1::aptos_account::transfer',
      type_arguments: [],
      arguments: [normalizeAddress(recipient), normalizeAmount(amount)]
    }
  }

  /**
   * Describes a fungible asset transfer via
   * `0x1::primary_fungible_store::transfer`, which auto-creates the recipient's
   * primary store if it does not exist.
   *
   * @protected
   * @param {string} metadata - The fungible asset metadata address.
   * @param {string} recipient - The recipient's address.
   * @param {number | bigint} amount - The amount to transfer (in base units).
   * @returns {EntryFunctionPayload} The payload descriptor.
   */
  _buildFungibleAssetTransferPayload (metadata, recipient, amount) {
    return {
      function: '0x1::primary_fungible_store::transfer',
      type_arguments: ['0x1::fungible_asset::Metadata'],
      arguments: [normalizeAddress(metadata), normalizeAddress(recipient), normalizeAmount(amount)]
    }
  }

  /**
   * Encodes a payload descriptor into BCS bytes for signing.
   *
   * @protected
   * @param {EntryFunctionPayload} payload - The payload descriptor.
   * @returns {Uint8Array} The serialized payload.
   */
  _encodePayloadBcs (payload) {
    const [module, moduleName, functionName] = payload.function.split('::')

    const typeArgs = payload.type_arguments.map((tag) => {
      const [tagModule, tagModuleName, tagStructName] = tag.split('::')

      return encodeStructTypeTag(tagModule, tagModuleName, tagStructName)
    })

    const args = []
    if (payload.function === '0x1::aptos_account::transfer') {
      args.push(encodeAddressArg(payload.arguments[0]), encodeU64Arg(payload.arguments[1]))
    } else {
      args.push(encodeAddressArg(payload.arguments[0]), encodeAddressArg(payload.arguments[1]), encodeU64Arg(payload.arguments[2]))
    }

    return encodeEntryFunctionPayload({ module, moduleName, functionName, typeArgs, args })
  }

  /**
   * Returns the chain id, fetching it from the ledger info if it was not
   * provided in the configuration. The result is validated as a u8 (Aptos
   * chain ids are 0-255) and only cached once valid, so a malformed response
   * does not poison the cache for the account's lifetime.
   *
   * @protected
   * @returns {Promise<number>} The chain id.
   * @throws {Error} If the chain id is not an integer in the range 0-255.
   */
  async _getChainId () {
    if (this._chainId === undefined) {
      const info = await this._rpc.getLedgerInfo()
      const chainId = Number(info.chain_id)

      if (!Number.isInteger(chainId) || chainId < 0 || chainId > 0xff) {
        throw new Error(`Invalid chain id from provider: ${info.chain_id}.`)
      }

      this._chainId = chainId
    } else if (!Number.isInteger(this._chainId) || this._chainId < 0 || this._chainId > 0xff) {
      throw new Error(`Invalid chain id in configuration: ${this._chainId}.`)
    }

    return this._chainId
  }

  /**
   * Returns the sender's next sequence number, or 0 if the account has not been
   * created on-chain yet.
   *
   * @protected
   * @param {string} address - The account address.
   * @returns {Promise<string>} The sequence number.
   */
  async _getSequenceNumber (address) {
    const account = await this._rpc.getAccount(address)

    return account ? account.sequence_number : '0'
  }

  /**
   * Returns the current gas unit price (in octas).
   *
   * @protected
   * @returns {Promise<bigint>} The gas unit price.
   * @throws {Error} If the provider returns an invalid gas price estimate.
   */
  async _getGasUnitPrice () {
    const estimate = await this._rpc.estimateGasPrice()
    const price = toGasPrice(estimate.gas_estimate)

    if (price === null) {
      throw new Error(`Invalid gas price estimate from provider: ${estimate.gas_estimate}.`)
    }

    return price
  }

  /**
   * Returns the transaction expiration timestamp (in seconds).
   *
   * @protected
   * @returns {number} The expiration timestamp.
   */
  _expirationTimestamp () {
    return Math.floor(Date.now() / 1000) + this._txnExpirationSecs
  }

  /**
   * Simulates a transaction carrying the given payload and returns the
   * estimated fee in octas. Requires the account's public key (see
   * {@link _simulate}).
   *
   * @private
   * @param {EntryFunctionPayload} payload - The payload descriptor.
   * @returns {Promise<bigint>} The estimated fee.
   */
  async _simulateFee (payload) {
    const { gas_used: gasUsed, gas_unit_price: gasUnitPrice } = await this._simulate(payload)

    return BigInt(gasUsed) * BigInt(gasUnitPrice)
  }

  /**
   * Simulates a transaction carrying the given payload and returns the raw
   * simulation result (including `gas_used` and `gas_unit_price`).
   *
   * The simulation requires the account's public key (to derive the
   * authentication key) and a zero signature. Throws when the public key is
   * unknown.
   *
   * @protected
   * @param {EntryFunctionPayload} payload - The payload descriptor.
   * @returns {Promise<AptosSimulationResult>} The simulation result.
   * @throws {Error} If the simulation reports a failed execution (`success: false`).
   */
  async _simulate (payload) {
    // Simulation needs the public key to derive the authentication key; an
    // account built from an address alone cannot be simulated.
    if (!this._publicKey) {
      throw new Error('A public key is required to simulate transactions. Use a full wallet account.')
    }

    const publicKey = `0x${bytesToHex(this._publicKey)}`

    const address = await this.getAddress()
    const [sequenceNumber, gasUnitPrice] = await Promise.all([
      this._getSequenceNumber(address),
      this._getGasUnitPrice()
    ])

    const result = await this._rpc.simulateTransaction({
      sender: address,
      sequence_number: sequenceNumber,
      max_gas_amount: DEFAULT_MAX_GAS_AMOUNT.toString(),
      gas_unit_price: gasUnitPrice.toString(),
      expiration_timestamp_secs: this._expirationTimestamp().toString(),
      payload: { type: 'entry_function_payload', ...payload },
      signature: { type: 'ed25519_signature', public_key: publicKey, signature: '0x' + '00'.repeat(64) }
    })

    if (!result.success) {
      throw new Error(`Transaction simulation failed: ${result.vm_status || 'unknown error'}.`)
    }

    return result
  }
}

/**
 * Normalizes an Aptos address to canonical 0x-prefixed 64-hex form, validating
 * that it is non-empty hexadecimal and fits in 32 bytes.
 *
 * @param {string} address - The address.
 * @returns {string} The canonical address.
 * @throws {Error} If the address is not a valid hex string or exceeds 32 bytes.
 */
export function normalizeAddress (address) {
  if (typeof address !== 'string') {
    throw new Error(`Invalid Aptos address: ${address}.`)
  }

  const raw = address.startsWith('0x') ? address.slice(2) : address

  if (raw.length === 0 || raw.length > 64 || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`Invalid Aptos address: ${address}.`)
  }

  return `0x${raw.padStart(64, '0')}`.toLowerCase()
}

// The single-signer Ed25519 authentication scheme identifier, appended to the
// public key before hashing to derive the authentication key.
const ED25519_SCHEME = 0x00

/**
 * Derives an Aptos account address from an Ed25519 public key:
 * `sha3_256(publicKey ‖ 0x00)`, hex-encoded.
 *
 * @param {Uint8Array} publicKey - The 32-byte Ed25519 public key.
 * @returns {string} The account address.
 */
export function deriveAddress (publicKey) {
  const input = new Uint8Array(publicKey.length + 1)

  input.set(publicKey, 0)
  input[publicKey.length] = ED25519_SCHEME

  return normalizeAddress(bytesToHex(sha3_256(input)))
}

/**
 * Validates a token amount and returns it as a decimal string. Amounts must be
 * non-negative integers within the u64 range (Aptos amounts are u64).
 *
 * @param {number | bigint} amount - The amount.
 * @returns {string} The amount as a decimal string.
 * @throws {Error} If the amount is negative, fractional, or exceeds the u64 maximum.
 */
export function normalizeAmount (amount) {
  // Accept only a bigint, an integer number, or a plain decimal-digit string.
  // This rejects booleans, arrays, hex strings ("0x10"), empty/whitespace
  // strings, and other inputs that BigInt() would otherwise silently coerce
  // into a passing-but-unintended amount.
  let value
  if (typeof amount === 'bigint') {
    value = amount
  } else if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new Error(`Invalid amount (must be an integer): ${amount}.`)
    }
    value = BigInt(amount)
  } else if (typeof amount === 'string' && /^\d+$/.test(amount)) {
    value = BigInt(amount)
  } else {
    throw new Error(`Invalid amount: ${amount}.`)
  }

  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`Amount out of u64 range: ${amount}.`)
  }

  return value.toString()
}

/**
 * Coerces a gas-price estimate into a non-negative bigint, or null if it is
 * missing or not a valid non-negative integer. Hex strings, booleans, floats,
 * and negatives are treated as invalid.
 *
 * @param {unknown} value - The raw estimate from the provider.
 * @returns {bigint | null} The validated gas price, or null.
 */
export function toGasPrice (value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? BigInt(value) : null
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value)
  }

  if (typeof value === 'bigint') {
    return value >= 0n ? value : null
  }

  return null
}
