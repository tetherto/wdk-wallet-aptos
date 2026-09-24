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

import WalletManager from '@tetherto/wdk-wallet'

import WalletAccountAptos from './wallet-account-aptos.js'
import { toGasPrice } from './wallet-account-read-only-aptos.js'

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */

/** @typedef {import('./aptos-rpc.js').default} AptosRpc */
/** @typedef {import('./wallet-account-read-only-aptos.js').AptosWalletConfig} AptosWalletConfig */

// The fee-rate multiplier (in basis points / 100) applied to the standard gas
// estimate for the 'fast' tier, used as a fallback when the node does not
// return a prioritized estimate.
const FEE_RATE_FAST_MULTIPLIER = 150n

export default class WalletManagerAptos extends WalletManager {
  /**
   * The aptos wallet configuration. Re-declared to narrow the inherited base
   * `WalletConfig` to the Aptos-specific shape in the generated declarations.
   *
   * @protected
   * @type {AptosWalletConfig}
   */
  _config

  /**
   * Creates a new wallet manager for the aptos blockchain.
   *
   * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed.
   * @param {AptosWalletConfig} [config] - The configuration object.
   */
  constructor (seed, config = {}) {
    super(seed, config)

    this._config = config

    /**
     * The Aptos REST client. Shared with every account this manager creates, so two accounts
     * never open two clients for the same endpoint.
     *
     * @protected
     * @type {AptosRpc | undefined}
     */
    this._rpc = WalletAccountAptos._buildRpc(config)
  }

  /**
   * Returns the wallet account at a specific index (derived per [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)).
   *
   * @example
   * // Returns the account with derivation path m/44'/637'/index'/0'/0'
   * const account = await wallet.getAccount(1);
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<WalletAccountAptos>} The account.
   */
  async getAccount (index = 0) {
    return this.getAccountByPath(`${index}'/0'/0'`)
  }

  /**
   * Returns the wallet account at a specific SLIP-0010 derivation path.
   *
   * @example
   * // Returns the account with derivation path m/44'/637'/0'/0'/1'
   * const account = await wallet.getAccountByPath("0'/0'/1'");
   * @param {string} path - The derivation path (e.g. "0'/0'/0'").
   * @returns {Promise<WalletAccountAptos>} The account.
   */
  async getAccountByPath (path) {
    // Construct and cache synchronously, before any await yields the event
    // loop, so concurrent calls for the same path share one account rather than
    // each deriving an orphaned key the disposal sweep would never zero.
    // Derivation is synchronous; WalletAccountAptos.at only wraps the
    // constructor in a promise for interface parity.
    if (!this._accounts[path]) {
      this._accounts[path] = new WalletAccountAptos(this.seed, path, this._accountConfig())
    }

    return this._accounts[path]
  }

  /**
   * Builds the account config, injecting the manager's shared rpc client so accounts reuse
   * it instead of opening their own.
   *
   * @private
   * @returns {AptosWalletConfig} The account configuration.
   */
  _accountConfig () {
    return { ...this._config, provider: this._rpc }
  }

  /**
   * Returns the current fee rates (gas unit prices, in octas).
   *
   * @returns {Promise<FeeRates>} The fee rates.
   */
  async getFeeRates () {
    if (!this._rpc) {
      throw new Error('The wallet must be connected to a provider to get fee rates.')
    }

    const estimate = await this._rpc.estimateGasPrice()

    const normal = toGasPrice(estimate.gas_estimate)

    if (normal === null) {
      throw new Error(`Invalid gas price estimate from provider: ${estimate.gas_estimate}.`)
    }

    const prioritized = toGasPrice(estimate.prioritized_gas_estimate)
    const fast = prioritized ?? (normal * FEE_RATE_FAST_MULTIPLIER) / 100n

    // The fast tier must never be cheaper than the normal tier, even if the
    // provider returns an inverted or zero prioritized estimate.
    return { normal, fast: fast > normal ? fast : normal }
  }
}
