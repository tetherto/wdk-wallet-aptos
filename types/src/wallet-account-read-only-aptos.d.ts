/**
 * Normalizes an Aptos address to canonical 0x-prefixed 64-hex form, validating
 * that it is non-empty hexadecimal and fits in 32 bytes.
 *
 * @param {string} address - The address.
 * @returns {string} The canonical address.
 * @throws {Error} If the address is not a valid hex string or exceeds 32 bytes.
 */
export function normalizeAddress(address: string): string;
/**
 * Derives an Aptos account address from an Ed25519 public key:
 * `sha3_256(publicKey ‖ 0x00)`, hex-encoded.
 *
 * @param {Uint8Array} publicKey - The 32-byte Ed25519 public key.
 * @returns {string} The account address.
 */
export function deriveAddress(publicKey: Uint8Array): string;
/**
 * Validates a token amount and returns it as a decimal string. Amounts must be
 * non-negative integers within the u64 range (Aptos amounts are u64).
 *
 * @param {number | bigint} amount - The amount.
 * @returns {string} The amount as a decimal string.
 * @throws {Error} If the amount is negative, fractional, or exceeds the u64 maximum.
 */
export function normalizeAmount(amount: number | bigint): string;
/**
 * Coerces a gas-price estimate into a non-negative bigint, or null if it is
 * missing or not a valid non-negative integer. Hex strings, booleans, floats,
 * and negatives are treated as invalid.
 *
 * @param {unknown} value - The raw estimate from the provider.
 * @returns {bigint | null} The validated gas price, or null.
 */
export function toGasPrice(value: unknown): bigint | null;
/**
 * Read-only Aptos wallet account implementation.
 *
 * @implements {IWalletAccountReadOnly}
 */
export default class WalletAccountReadOnlyAptos extends WalletAccountReadOnly implements IWalletAccountReadOnly {
    /**
     * Builds the Aptos REST client from the wallet configuration: a url (or list of urls, for
     * failover), or an already-built `AptosRpc` reused as-is.
     *
     * @protected
     * @param {AptosWalletConfig} [config] - The configuration object.
     * @returns {AptosRpc | undefined} The rpc client, or undefined if none is configured.
     */
    protected static _buildRpc(config?: AptosWalletConfig): AptosRpc | undefined;
    /**
     * Creates a new aptos read-only wallet account.
     *
     * @param {string} address - The account's address.
     * @param {AptosWalletConfig} [config] - The configuration object.
     * @param {Uint8Array} [publicKey] - The account's Ed25519 public key (32 bytes). Required to verify signatures, since an Aptos address is a one-way hash of the public key and cannot recover it.
     */
    constructor(address: string, config?: AptosWalletConfig, publicKey?: Uint8Array);
    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {AptosWalletConfig}
     */
    protected _config: AptosWalletConfig;
    /**
     * The account's Ed25519 public key, if known. Set when the account is
     * derived from a seed (directly or via {@link toReadOnlyAccount}); absent
     * when the account is constructed from an address alone.
     *
     * @protected
     * @type {Uint8Array | undefined}
     */
    protected _publicKey: Uint8Array | undefined;
    /**
     * The Aptos REST client.
     *
     * @protected
     * @type {AptosRpc | undefined}
     */
    protected _rpc: AptosRpc | undefined;
    /**
     * The cached chain id.
     *
     * @private
     * @type {number | undefined}
     */
    private _chainId;
    /**
     * The transaction expiration window, in seconds. Resolved once here rather
     * than recomputed on every transaction.
     *
     * @private
     * @type {number}
     */
    private _txnExpirationSecs;
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
    getTransactionReceipt(hash: string): Promise<AptosTransactionReceipt | null>;
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
    getTransaction(hash: string): Promise<AptosTransactionInfo>;
    /**
     * Blocks until a transaction reaches a terminal state (the requested finality target or `dropped`), or times out.
     *
     * @param {string} hash - The transaction's hash.
     * @param {WaitForTransactionOptions} [options] - The wait options.
     * @returns {Promise<AptosTransactionInfo>} The terminal receipt: the finality target reached (inspect `success` to tell success from revert), or `dropped`.
     * @throws {TimeoutError} If the target is not reached before the timeout.
     */
    waitForTransaction(hash: string, options?: WaitForTransactionOptions): Promise<AptosTransactionInfo>;
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
    protected _buildNativeTransferPayload(recipient: string, amount: number | bigint): EntryFunctionPayload;
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
    protected _buildFungibleAssetTransferPayload(metadata: string, recipient: string, amount: number | bigint): EntryFunctionPayload;
    /**
     * Encodes a payload descriptor into BCS bytes for signing.
     *
     * @protected
     * @param {EntryFunctionPayload} payload - The payload descriptor.
     * @returns {Uint8Array} The serialized payload.
     */
    protected _encodePayloadBcs(payload: EntryFunctionPayload): Uint8Array;
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
    protected _getChainId(): Promise<number>;
    /**
     * Returns the sender's next sequence number, or 0 if the account has not been
     * created on-chain yet.
     *
     * @protected
     * @param {string} address - The account address.
     * @returns {Promise<string>} The sequence number.
     */
    protected _getSequenceNumber(address: string): Promise<string>;
    /**
     * Returns the current gas unit price (in octas).
     *
     * @protected
     * @returns {Promise<bigint>} The gas unit price.
     * @throws {Error} If the provider returns an invalid gas price estimate.
     */
    protected _getGasUnitPrice(): Promise<bigint>;
    /**
     * Returns the transaction expiration timestamp (in seconds).
     *
     * @protected
     * @returns {number} The expiration timestamp.
     */
    protected _expirationTimestamp(): number;
    /**
     * Simulates a transaction carrying the given payload and returns the
     * estimated fee in octas. Requires the account's public key (see
     * {@link _simulate}).
     *
     * @private
     * @param {EntryFunctionPayload} payload - The payload descriptor.
     * @returns {Promise<bigint>} The estimated fee.
     */
    private _simulateFee;
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
    protected _simulate(payload: EntryFunctionPayload): Promise<AptosSimulationResult>;
}
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type AptosSimulationResult = import("./aptos-rpc.js").AptosSimulationResult;
export type WaitForTransactionOptions = import("@tetherto/wdk-wallet").WaitForTransactionOptions;
export type TransactionReceipt = import("@tetherto/wdk-wallet").TransactionReceipt;
export type AptosWalletConfig = {
    /**
     * - The Aptos fullnode REST url (e.g. "https://fullnode.mainnet.aptoslabs.com/v1"), or an already-built `AptosRpc` client. An array of urls enables failover. An already-built client is reused as-is, which lets a manager share a single client across all the accounts it creates.
     */
    provider?: string | AptosRpc | string[];
    /**
     * - The chain id (mainnet: 1, testnet: 2). Fetched from the ledger info on first use if omitted.
     */
    chainId?: number;
    /**
     * - The number of failover retry attempts if 'provider' is a list of urls (default: 3).
     */
    retries?: number;
    /**
     * - The transaction expiration window in seconds from now (default: 60).
     */
    txnExpirationSecs?: number;
    /**
     * - The maximum allowed fee in octas for transfer operations.
     */
    transferMaxFee?: number | bigint;
};
export type AptosTransaction = {
    /**
     * - The recipient's address.
     */
    to: string;
    /**
     * - The amount of APT to send (in octas, 1 APT = 100,000,000 octas).
     */
    value: number | bigint;
};
export type EntryFunctionPayload = {
    /**
     * - The fully-qualified entry function (e.g. "0x1::aptos_account::transfer").
     */
    function: string;
    /**
     * - The type arguments.
     */
    type_arguments: string[];
    /**
     * - The function arguments (addresses as hex, u64 amounts as decimal strings).
     */
    arguments: string[];
};
/**
 * A committed or pending transaction as returned by the fullnode REST API.
 */
export type AptosTransactionReceipt = {
    /**
     * - The transaction state ("pending_transaction" or "user_transaction").
     */
    type: string;
    /**
     * - The transaction hash.
     */
    hash: string;
    /**
     * - Whether execution succeeded (present once committed).
     */
    success?: boolean;
    /**
     * - The VM status message (present once committed).
     */
    vm_status?: string;
    /**
     * - The ledger version the transaction was committed at (present once committed).
     */
    version?: string;
    /**
     * - The gas units consumed (present once committed).
     */
    gas_used?: string;
    /**
     * - The gas unit price in octas (present once committed).
     */
    gas_unit_price?: string;
};
/**
 * A normalized Aptos transaction receipt, extended with the raw fullnode transaction object.
 */
export type AptosTransactionInfo = TransactionReceipt & {
    transaction: AptosTransactionReceipt;
};
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet';
import AptosRpc from './aptos-rpc.js';
