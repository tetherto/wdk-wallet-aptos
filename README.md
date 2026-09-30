# @tetherto/wdk-wallet-aptos

[![npm version](https://img.shields.io/npm/v/%40tetherto%2Fwdk-wallet-aptos?style=flat-square)](https://www.npmjs.com/package/@tetherto/wdk-wallet-aptos)
[![npm downloads](https://img.shields.io/npm/dw/%40tetherto%2Fwdk-wallet-aptos?style=flat-square)](https://www.npmjs.com/package/@tetherto/wdk-wallet-aptos)
[![license](https://img.shields.io/npm/l/%40tetherto%2Fwdk-wallet-aptos?style=flat-square)](https://github.com/tetherto/wdk-wallet-aptos/blob/main/LICENSE)

**Note**: This package is currently in beta. Please test thoroughly in development environments before using in production.

An [Aptos wallet module](https://docs.wdk.tether.io/sdk/wallet-modules/wallet-aptos/) for WDK (Wallet Development Kit) by Tether. This package provides a clean API for creating, managing, and interacting with Aptos wallets using BIP-39 seed phrases and ed25519 (SLIP-0010) key derivation.

## About WDK

This module is part of the [**WDK (Wallet Development Kit)**](https://docs.wdk.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control.

For detailed documentation about the complete WDK ecosystem, visit [docs.wdk.tether.io](https://docs.wdk.tether.io).

## ⬇️ Installation

You can install it using npm:

```bash
npm install @tetherto/wdk-wallet-aptos
```

## 🚀 Quick Start

### Importing from `@tetherto/wdk-wallet-aptos`

```javascript
import WalletManagerAptos, {
  WalletAccountAptos,
  WalletAccountReadOnlyAptos,
} from '@tetherto/wdk-wallet-aptos'
```

### Create a Wallet Manager (seed-based)

```javascript
import WalletManagerAptos from '@tetherto/wdk-wallet-aptos'

// Use a BIP-39 seed phrase (replace with your own secure phrase)
const seedPhrase =
  'test only example nut use this real life secret phrase must random'

// Create wallet manager with provider config (provider is required for chain ops)
const wallet = new WalletManagerAptos(seedPhrase, {
  provider: 'https://fullnode.mainnet.aptoslabs.com/v1', // any Aptos fullnode REST url
  transferMaxFee: 100000n, // Optional: max fee in octas (BigInt)
})

// Get a full access account
const account0 = await wallet.getAccount(0)

// Convert to a read-only account
const readOnlyAccount = await account0.toReadOnlyAccount()
```

### Managing Multiple Accounts (seed-based manager)

```javascript
import WalletManagerAptos from '@tetherto/wdk-wallet-aptos'

const wallet = new WalletManagerAptos(seedPhrase, {
  provider: 'https://fullnode.mainnet.aptoslabs.com/v1',
})

// Get the first account (index 0)
const account = await wallet.getAccount(0) // m/44'/637'/0'/0'/0'
const address = await account.getAddress() // 0x...
console.log('Account 0 address:', address)

// Get the second account (index 1)
const account1 = await wallet.getAccount(1) // m/44'/637'/1'/0'/0'
const address1 = await account1.getAddress() // 0x...
console.log('Account 1 address:', address1)

// Get account by custom derivation path
// Full path will be m/44'/637'/5'/0'/0'
const customAccount = await wallet.getAccountByPath("5'/0'/0'")
const customAddress = await customAccount.getAddress()
console.log('Custom account address:', customAddress)

// Note: ed25519 (SLIP-0010) derivation requires every path segment to be hardened.
// All accounts inherit the provider configuration from the wallet manager.
```

### Checking Balances

#### Owned Account

For accounts where you have the seed phrase and full access:

```javascript
// Get native APT balance (in octas, 1 APT = 100,000,000 octas)
const balance = await account.getBalance()
console.log('APT balance:', balance, 'octas')

// Get fungible asset balance by its metadata address
// USDT is a native fungible asset on Aptos
const USDT = '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b'
const tokenBalance = await account.getTokenBalance(USDT)
console.log('USDT balance:', tokenBalance)

// Note: Provider is required for balance checks.
```

#### Read-Only Account

For addresses where you don't have the seed phrase:

```javascript
import { WalletAccountReadOnlyAptos } from '@tetherto/wdk-wallet-aptos'

// Create a read-only account
const readOnlyAccount = new WalletAccountReadOnlyAptos('0x...', {
  provider: 'https://fullnode.mainnet.aptoslabs.com/v1', // Required for balance checks
})

// Check native APT balance
const balance = await readOnlyAccount.getBalance()
console.log('APT balance:', balance, 'octas')

// Check fungible asset balance by its metadata address
const tokenBalance = await readOnlyAccount.getTokenBalance('0x...')
console.log('Token balance:', tokenBalance)
```

### Sending Transactions

Send native APT and estimate fees using `WalletAccountAptos`. The module simulates each transaction to size gas before signing.

```javascript
// Send native APT (via 0x1::aptos_account::transfer, auto-creates the recipient)
const result = await account.sendTransaction({
  to: '0x...', // Recipient address
  value: 100000000n, // 1 APT in octas
})
console.log('Transaction hash:', result.hash)
console.log('Transaction fee:', result.fee, 'octas')

// Get transaction fee estimate
const quote = await account.quoteSendTransaction({
  to: '0x...',
  value: 100000000n,
})
console.log('Estimated fee:', quote.fee, 'octas')
```

### Token Transfers

Transfer fungible assets and estimate fees using `WalletAccountAptos`. Uses `0x1::primary_fungible_store::transfer`, which auto-creates the recipient's primary store.

```javascript
// Transfer a fungible asset by its metadata address
const transferResult = await account.transfer({
  token: '0x...', // Fungible asset metadata address
  recipient: '0x...', // Recipient's address
  amount: 1000000n, // Amount in the token's base units (USDT has 6 decimals)
})
console.log('Transfer hash:', transferResult.hash)
console.log('Transfer fee:', transferResult.fee, 'octas')

// Quote token transfer fee
const transferQuote = await account.quoteTransfer({
  token: '0x...',
  recipient: '0x...',
  amount: 1000000n,
})
console.log('Transfer fee estimate:', transferQuote.fee, 'octas')
```

### Message Signing and Verification

Sign messages using `WalletAccountAptos` and verify signatures using `WalletAccountReadOnlyAptos`.

```javascript
// Sign a message
const message = 'Hello, Aptos!'
const signature = await account.sign(message)
console.log('Signature:', signature)

// Verify a signature (can use read-only account derived from a seed)
const isValid = await readOnlyAccount.verify(message, signature)
console.log('Signature valid:', isValid)
```

### Fee Management

Retrieve current fee rates using `WalletManagerAptos`.

```javascript
// Get current fee rates (in octas per gas unit)
const feeRates = await wallet.getFeeRates()
console.log('Normal fee rate:', feeRates.normal)
console.log('Fast fee rate:', feeRates.fast)
```

### Memory Management

Clear sensitive data from memory using `dispose` methods in `WalletAccountAptos` and `WalletManagerAptos`.

```javascript
// Dispose wallet accounts to clear private keys from memory
account.dispose()

// Dispose entire wallet manager
wallet.dispose()
```

## Key Capabilities

- **BIP-39 Seed Phrase Support**: Generate and validate mnemonic seed phrases
- **SLIP-0010 Derivation Paths**: ed25519 HD derivation on the Aptos path (`m/44'/637'/…`, all segments hardened)
- **Multi-Account Management**: Derive multiple accounts from a single seed phrase
- **Fungible Asset (FA) Support**: Query balances and transfer fungible assets, including native USDT
- **Native APT Transfers**: Send APT with automatic simulation-based gas sizing
- **Message Signing**: Sign and verify ed25519 messages
- **Fee Estimation**: Network fee rates with normal/fast tiers
- **Secure Memory Disposal**: Clear private keys from memory when done
- **Bare-Runtime Compatible**: Talks to the fullnode REST API over `fetch`, with no Aptos SDK in the runtime path — runs on both Node.js and the Bare runtime

## Aptos specifics

- **Derivation**: `m/44'/637'/account'/0'/0'` (SLIP-0010 ed25519, all segments hardened). `getAccount(index)` maps to `account = index`.
- **Address**: 32-byte, derived as `sha3_256(publicKey ‖ 0x00)`, rendered as a `0x`-prefixed 64-hex string. Short forms (e.g. `0xa`) are accepted as inputs and normalized.
- **Token model**: tokens use the [Fungible Asset (FA)](https://aptos.dev/build/smart-contracts/fungible-asset) standard. `getTokenBalance(tokenAddress)` and `transfer({ token, ... })` take the **FA metadata address** (e.g. the USDT metadata address above), not a coin type tag.
- **Balances**: read through the unified `/accounts/{addr}/balance/{asset}` endpoint, which aggregates legacy `Coin` and migrated FA balances and returns `0` for accounts that do not exist yet.
- **Offline signing**: `signTransaction` covers native APT transfers only. Token (fungible asset) transfers go through `transfer`, which simulates, signs, and submits in one call.
- **Decimals**: APT = 8, USDT = 6.

## Compatibility

- **Aptos Mainnet** (chain id `1`) and **Testnet** (chain id `2`)
- **Runtimes**: Node.js and the [Bare](https://github.com/holepunchto/bare) runtime

## Community

Join the [WDK Discord](https://discord.gg/arYXDhHB2w) to connect with other developers.

## Support

For support, please [open an issue](https://github.com/tetherto/wdk-wallet-aptos/issues) on GitHub or reach out via [email](mailto:wallet-info@tether.io).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/tetherto/wdk-wallet-aptos/blob/main/LICENSE) file for details.
