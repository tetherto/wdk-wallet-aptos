export default class WalletManagerAptos extends WalletManager {
    /**
     * Creates a new wallet manager for the aptos blockchain.
     *
     * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed.
     * @param {AptosWalletConfig} [config] - The configuration object.
     */
    constructor(seed: string | Uint8Array, config?: AptosWalletConfig);
    /**
     * The aptos wallet configuration. Re-declared to narrow the inherited base
     * `WalletConfig` to the Aptos-specific shape in the generated declarations.
     *
     * @protected
     * @type {AptosWalletConfig}
     */
    protected _config: AptosWalletConfig;
    /**
     * The Aptos REST client.
     *
     * @protected
     * @type {AptosRpc | undefined}
     */
    protected _rpc: AptosRpc | undefined;
    /**
     * Returns the wallet account at a specific index (derived per [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)).
     *
     * @example
     * // Returns the account with derivation path m/44'/637'/index'/0'/0'
     * const account = await wallet.getAccount(1);
     * @param {number} [index] - The index of the account to get (default: 0).
     * @returns {Promise<WalletAccountAptos>} The account.
     */
    getAccount(index?: number): Promise<WalletAccountAptos>;
    /**
     * Returns the wallet account at a specific SLIP-0010 derivation path.
     *
     * @example
     * // Returns the account with derivation path m/44'/637'/0'/0'/1'
     * const account = await wallet.getAccountByPath("0'/0'/1'");
     * @param {string} path - The derivation path (e.g. "0'/0'/0'").
     * @returns {Promise<WalletAccountAptos>} The account.
     */
    getAccountByPath(path: string): Promise<WalletAccountAptos>;
    /**
     * Builds the account config, injecting the manager's shared rpc client so accounts reuse
     * it instead of opening their own.
     *
     * @private
     * @returns {AptosWalletConfig} The account configuration.
     */
    private _accountConfig;
}
export type FeeRates = import("@tetherto/wdk-wallet").FeeRates;
export type AptosWalletConfig = import("./wallet-account-read-only-aptos.js").AptosWalletConfig;
import WalletManager from '@tetherto/wdk-wallet';
import AptosRpc from './aptos-rpc.js';
import WalletAccountAptos from './wallet-account-aptos.js';
