/**
 * Full-featured Aptos wallet account implementation with signing capabilities.
 *
 * @implements {IWalletAccount}
 */
export default class WalletAccountAptos extends WalletAccountReadOnlyAptos implements IWalletAccount {
    /**
     * Creates a new aptos wallet account.
     *
     * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed (mnemonic phrase or raw seed bytes).
     * @param {string} path - The derivation path (e.g. "0'/0'/0'").
     * @param {AptosWalletConfig} [config] - The configuration object.
     */
    constructor(seed: string | Uint8Array, path: string, config?: AptosWalletConfig);
    /** @private */
    private _path;
    /**
     * The raw Ed25519 private key (32 bytes), or undefined once disposed.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    private _privateKey;
    /** @private */
    private _disposed;
    /**
     * True if the account has been disposed.
     *
     * @type {boolean}
     */
    get disposed(): boolean;
    /**
     * The derivation path's index of this account.
     *
     * @type {number}
     */
    get index(): number;
    /**
     * The derivation path of this account.
     *
     * @type {string}
     */
    get path(): string;
    /**
     * The account's key pair.
     *
     * @type {KeyPair}
     */
    get keyPair(): KeyPair;
    /**
     * Signs a message.
     *
     * @param {string} message - The message to sign.
     * @returns {Promise<string>} The message's signature (hex).
     * @throws {DisposalError} If the account has been disposed.
     */
    sign(message: string): Promise<string>;
    /**
     * Signs a native APT transfer without broadcasting it. Offline signing of
     * fungible-asset (token) transfers is not supported; use {@link transfer}
     * for tokens.
     *
     * @param {AptosTransaction} tx - The native APT transaction to sign.
     * @returns {Promise<SignedTransaction>} The signed transaction (JSON form, ready to submit).
     * @throws {DisposalError} If the account has been disposed.
     */
    signTransaction(tx: AptosTransaction): Promise<SignedTransaction>;
    /**
     * Sends a transaction.
     *
     * @param {AptosTransaction} tx - The transaction.
     * @returns {Promise<TransactionResult>} The transaction's result.
     * @throws {DisposalError} If the account has been disposed.
     */
    sendTransaction(tx: AptosTransaction): Promise<TransactionResult>;
    /**
     * Transfers a fungible asset to another address.
     *
     * @param {TransferOptions} options - The transfer's options.
     * @returns {Promise<TransferResult>} The transfer's result.
     * @throws {DisposalError} If the account has been disposed.
     */
    transfer(options: TransferOptions): Promise<TransferResult>;
    /**
     * Returns a read-only copy of the account.
     *
     * @returns {Promise<WalletAccountReadOnlyAptos>} The read-only account.
     */
    toReadOnlyAccount(): Promise<WalletAccountReadOnlyAptos>;
    /**
     * Disposes the wallet account, erasing the private key from the memory.
     */
    dispose(): void;
    /**
     * Signs a payload descriptor into a submittable transaction (JSON form),
     * using the supplied gas parameters.
     *
     * @private
     * @param {EntryFunctionPayload} payload - The payload descriptor.
     * @param {TransactionGasParams} gas - The gas parameters.
     * @returns {Promise<SignedTransaction>} The signed transaction (JSON form).
     */
    private _signPayload;
    /**
     * Simulates a payload once and signs it, deriving `max_gas_amount` from the
     * simulated usage (with a safety buffer) and `gas_unit_price` from the same
     * simulation. Optionally enforces a maximum fee.
     *
     * @private
     * @param {EntryFunctionPayload} payload - The payload descriptor.
     * @param {number | bigint} [maxFee] - The maximum allowed fee in octas.
     * @returns {Promise<SignedTransactionResult>} The signed transaction and its estimated fee.
     */
    private _buildSignedTransaction;
    /**
     * Signs and submits a transaction for a payload descriptor.
     *
     * @private
     * @param {EntryFunctionPayload} payload - The payload descriptor.
     * @param {number | bigint} [maxFee] - The maximum allowed fee in octas.
     * @returns {Promise<TransactionResult>} The transaction's result.
     */
    private _submit;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferOptions = import("@tetherto/wdk-wallet").TransferOptions;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type AptosTransaction = import("./wallet-account-read-only-aptos.js").AptosTransaction;
export type AptosWalletConfig = import("./wallet-account-read-only-aptos.js").AptosWalletConfig;
export type EntryFunctionPayload = import("./wallet-account-read-only-aptos.js").EntryFunctionPayload;
export type TransactionGasParams = {
    /**
     * - The maximum gas units.
     */
    maxGasAmount: bigint;
    /**
     * - The gas unit price (in octas).
     */
    gasUnitPrice: bigint;
};
/**
 * A signed transaction in the JSON form accepted by the Aptos REST API.
 */
export type SignedTransaction = {
    /**
     * - The sender's address.
     */
    sender: string;
    /**
     * - The sender's sequence number.
     */
    sequence_number: string;
    /**
     * - The maximum gas units.
     */
    max_gas_amount: string;
    /**
     * - The gas unit price (in octas).
     */
    gas_unit_price: string;
    /**
     * - The expiration timestamp (in seconds).
     */
    expiration_timestamp_secs: string;
    /**
     * - The entry function payload.
     */
    payload: EntryFunctionPayload & {
        type: string;
    };
    /**
     * - The Ed25519 signature.
     */
    signature: {
        type: string;
        public_key: string;
        signature: string;
    };
};
/**
 * A signed transaction paired with its estimated fee.
 */
export type SignedTransactionResult = {
    /**
     * - The signed transaction, ready to submit.
     */
    signedTransaction: SignedTransaction;
    /**
     * - The estimated fee in octas.
     */
    fee: bigint;
};
import WalletAccountReadOnlyAptos from './wallet-account-read-only-aptos.js';
