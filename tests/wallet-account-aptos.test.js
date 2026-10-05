'use strict'

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'

import { hexToBytes } from '@noble/hashes/utils'

import { DisposalError } from '@tetherto/wdk-wallet'

import WalletAccountAptos from '../src/wallet-account-aptos.js'
import WalletAccountReadOnlyAptos from '../src/wallet-account-read-only-aptos.js'

const SEED_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const ADDRESS = '0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf'
const PUBLIC_KEY = 'a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60'
const PRIVATE_KEY = 'cc92c0eaf80206d817f150e21917f797e49cf644a33ac514de3c316baa2f1bf5'
const RPC_URL = 'https://mock-aptos.test/v1'
const USDT = '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b'
const RECIPIENT = '0x1111111111111111111111111111111111111111111111111111111111111111'

function bytesToHex (bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

describe('WalletAccountAptos', () => {
  let account

  beforeEach(async () => {
    globalThis.fetch = jest.fn()
    account = new WalletAccountAptos(SEED_PHRASE, "0'/0'/0'", { provider: RPC_URL, chainId: 1 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('derivation', () => {
    it('derives the expected address, public key and private key', () => {
      const { publicKey, privateKey } = account.keyPair

      expect(account.path).toBe("m/44'/637'/0'/0'/0'")
      expect(account.index).toBe(0)
      expect(bytesToHex(publicKey)).toBe(PUBLIC_KEY)
      expect(bytesToHex(privateKey)).toBe(PRIVATE_KEY)
    })

    it('throws on a non-hardened path', () => {
      expect(() => new WalletAccountAptos(SEED_PHRASE, "0'/0/0")).toThrow('hardened')
    })

    it('rejects paths that are not exactly three hardened segments', () => {
      for (const p of ["0'", "0'/0'", "0'/0'/0'/0'", "0'/0'/0'/0'/0'"]) {
        expect(() => new WalletAccountAptos(SEED_PHRASE, p)).toThrow('exactly three hardened segments')
      }
    })

    it('rejects a non-numeric path segment', () => {
      expect(() => new WalletAccountAptos(SEED_PHRASE, "0'/x'/0'")).toThrow('hardened index')
    })

    it('rejects leading-zero index segments that would alias another path', () => {
      expect(() => new WalletAccountAptos(SEED_PHRASE, "00'/0'/0'")).toThrow('leading zeros')
      expect(() => new WalletAccountAptos(SEED_PHRASE, "0'/01'/0'")).toThrow('leading zeros')
    })

    it('throws on an invalid seed phrase', () => {
      expect(() => new WalletAccountAptos('not valid', "0'/0'/0'")).toThrow('invalid')
    })

    it('does not mutate a caller-supplied Uint8Array seed', async () => {
      const bip39 = await import('bip39')
      const seed = bip39.mnemonicToSeedSync(SEED_PHRASE)
      const copy = seed.slice()

      new WalletAccountAptos(seed, "0'/0'/0'") // eslint-disable-line no-new

      expect(seed).toEqual(copy)
    })
  })

  describe('sign / verify', () => {
    it('signs a message and verifies its own signature', async () => {
      const signature = await account.sign('hello world')

      expect(typeof signature).toBe('string')
      expect(await account.verify('hello world', signature)).toBe(true)
    })

    it('rejects a tampered message', async () => {
      const signature = await account.sign('hello world')

      expect(await account.verify('goodbye world', signature)).toBe(false)
    })

    it('throws when signing after disposal', async () => {
      account.dispose()

      await expect(account.sign('x')).rejects.toThrow(DisposalError)
    })
  })

  describe('getAddress', () => {
    it('returns the derived address', async () => {
      expect(await account.getAddress()).toBe(ADDRESS)
    })
  })

  describe('toReadOnlyAccount', () => {
    it('returns a read-only account with the same address', async () => {
      const readOnly = await account.toReadOnlyAccount()

      expect(readOnly).toBeInstanceOf(WalletAccountReadOnlyAptos)
      expect(await readOnly.getAddress()).toBe(ADDRESS)
    })
  })

  describe('dispose', () => {
    it('zeroes the private key', () => {
      account.dispose()

      expect(account.keyPair.privateKey).toBeUndefined()
    })

    it('exposes the disposed state', () => {
      expect(account.disposed).toBe(false)

      account.dispose()

      expect(account.disposed).toBe(true)
    })

    it('throws DisposalError from signing methods once disposed', async () => {
      account.dispose()

      await expect(account.sign('x')).rejects.toThrow(DisposalError)
      await expect(account.signTransaction({ to: RECIPIENT, value: 1n })).rejects.toThrow(DisposalError)
      await expect(account.sendTransaction({ to: RECIPIENT, value: 1n })).rejects.toThrow(DisposalError)
      await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: 1n })).rejects.toThrow(DisposalError)
    })
  })

  describe('transfer', () => {
    let submitted
    let submittedBody

    function mockSimulateAndSubmit ({ gasUsed, gasUnitPrice, hash, success = true, vmStatus = 'Executed successfully' }) {
      submitted = false
      submittedBody = undefined
      globalThis.fetch.mockImplementation(async (url, options) => {
        const u = String(url)
        let body
        if (u.includes('/estimate_gas_price')) {
          body = { gas_estimate: gasUnitPrice }
        } else if (u.includes('/accounts/') && u.includes('/balance/')) {
          body = '0'
        } else if (u.endsWith('/accounts/' + ADDRESS)) {
          body = { sequence_number: '11', authentication_key: ADDRESS }
        } else if (u.includes('/transactions/simulate')) {
          body = [{ success, vm_status: vmStatus, gas_used: String(gasUsed), gas_unit_price: String(gasUnitPrice) }]
        } else if (u.endsWith('/transactions')) {
          submitted = true
          submittedBody = JSON.parse(options.body)
          body = { hash }
        } else {
          body = {}
        }
        return { ok: true, status: 200, statusText: 'OK', text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
      })
    }

    it('enforces transferMaxFee', async () => {
      account = new WalletAccountAptos(SEED_PHRASE, "0'/0'/0'", { provider: RPC_URL, chainId: 1, transferMaxFee: 10n })
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' }) // fee = 10000

      await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: 1000000n }))
        .rejects.toThrow('Exceeded maximum fee')
    })

    it('caps max_gas_amount so the worst-case fee cannot exceed transferMaxFee', async () => {
      // Simulated fee = 100 * 100 = 10000, which passes the transferMaxFee guard (< 15000).
      // The buffered max_gas_amount (100 * 2 = 200) would allow a worst-case fee of
      // 200 * 100 = 20000, exceeding transferMaxFee. It must be capped to 15000 / 100 = 150.
      account = new WalletAccountAptos(SEED_PHRASE, "0'/0'/0'", { provider: RPC_URL, chainId: 1, transferMaxFee: 15000n })
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      await account.transfer({ token: USDT, recipient: RECIPIENT, amount: 1000000n })

      expect(submittedBody.max_gas_amount).toBe('150')
    })

    it('submits a transfer with the correct payload, signature, and gas, and returns hash + fee', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      const result = await account.transfer({ token: USDT, recipient: RECIPIENT, amount: 1000000n })

      expect(result.hash).toBe('0xdeadbeef')
      expect(result.fee).toBe(10000n)

      // Assert what was actually signed and POSTed — not just the echoed hash.
      expect(submittedBody.sender).toBe(ADDRESS)
      expect(submittedBody.sequence_number).toBe('11')
      expect(submittedBody.gas_unit_price).toBe('100')
      expect(submittedBody.max_gas_amount).toBe('200') // gas_used 100 * MAX_GAS_BUFFER 2
      expect(submittedBody.payload).toEqual({
        type: 'entry_function_payload',
        function: '0x1::primary_fungible_store::transfer',
        type_arguments: ['0x1::fungible_asset::Metadata'],
        arguments: [USDT, RECIPIENT, '1000000']
      })
      expect(submittedBody.signature.type).toBe('ed25519_signature')
      expect(submittedBody.signature.public_key).toBe(`0x${PUBLIC_KEY}`)
      expect(submittedBody.signature.signature).toMatch(/^0x[0-9a-f]{128}$/)
    })

    it('does NOT submit when the simulation fails', async () => {
      mockSimulateAndSubmit({ gasUsed: 0, gasUnitPrice: 100, hash: '0xdeadbeef', success: false, vmStatus: 'INSUFFICIENT_BALANCE' })

      await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: 1000000n }))
        .rejects.toThrow('simulation failed')
      expect(submitted).toBe(false)
    })

    it('rejects an amount above the u64 maximum before signing', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: 2n ** 64n }))
        .rejects.toThrow('out of u64 range')
      expect(submitted).toBe(false)
    })

    it('rejects a negative amount before signing', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: -1n }))
        .rejects.toThrow('out of u64 range')
      expect(submitted).toBe(false)
    })

    it('rejects a malformed recipient address before signing', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      await expect(account.transfer({ token: USDT, recipient: '0xZZZ', amount: 1000000n }))
        .rejects.toThrow('Invalid Aptos address')
      expect(submitted).toBe(false)
    })

    it('rejects type-confused amounts (boolean, array, hex string) before signing', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      for (const bad of [true, [5], '0x10', '', '1.5']) {
        await expect(account.transfer({ token: USDT, recipient: RECIPIENT, amount: bad }))
          .rejects.toThrow('Invalid amount')
      }
      expect(submitted).toBe(false)
    })

    it('accepts a plain decimal-string amount', async () => {
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      const result = await account.transfer({ token: USDT, recipient: RECIPIENT, amount: '1000000' })

      expect(result.hash).toBe('0xdeadbeef')
    })

    it('rejects an out-of-range configured chain id rather than truncating it', async () => {
      const bad = new WalletAccountAptos(SEED_PHRASE, "0'/0'/0'", { provider: RPC_URL, chainId: 256 })
      mockSimulateAndSubmit({ gasUsed: 100, gasUnitPrice: 100, hash: '0xdeadbeef' })

      await expect(bad.transfer({ token: USDT, recipient: RECIPIENT, amount: 1000000n }))
        .rejects.toThrow('Invalid chain id')
      expect(submitted).toBe(false)
    })

    it('sendTransaction submits a native APT transfer with the correct payload', async () => {
      mockSimulateAndSubmit({ gasUsed: 50, gasUnitPrice: 100, hash: '0xfeed' })

      const result = await account.sendTransaction({ to: RECIPIENT, value: 100000n })

      expect(result.hash).toBe('0xfeed')
      expect(result.fee).toBe(5000n)
      expect(submittedBody.payload).toEqual({
        type: 'entry_function_payload',
        function: '0x1::aptos_account::transfer',
        type_arguments: [],
        arguments: [RECIPIENT, '100000']
      })
      expect(submittedBody.signature.signature).toMatch(/^0x[0-9a-f]{128}$/)
    })

    it('sendTransaction does not submit when simulation fails', async () => {
      mockSimulateAndSubmit({ gasUsed: 0, gasUnitPrice: 100, hash: '0xfeed', success: false, vmStatus: 'INSUFFICIENT_BALANCE' })

      await expect(account.sendTransaction({ to: RECIPIENT, value: 100000n }))
        .rejects.toThrow('simulation failed')
      expect(submitted).toBe(false)
    })

    it('signTransaction returns a signed native transfer without submitting', async () => {
      mockSimulateAndSubmit({ gasUsed: 50, gasUnitPrice: 100, hash: '0xfeed' })

      const signed = await account.signTransaction({ to: RECIPIENT, value: 100000n })

      expect(submitted).toBe(false)
      expect(signed.payload.function).toBe('0x1::aptos_account::transfer')
      expect(signed.payload.arguments).toEqual([RECIPIENT, '100000'])
      expect(signed.signature.public_key).toBe(`0x${PUBLIC_KEY}`)
      expect(signed.signature.signature).toMatch(/^0x[0-9a-f]{128}$/)
    })
  })

  describe('signature correctness', () => {
    it('cryptographically signs the BCS RawTransaction (verifiable with ed25519)', async () => {
      // Locks the signing path with a real cryptographic check: reconstruct the
      // exact RawTransaction the module signed, rebuild the signing message
      // (sha3_256("APTOS::RawTransaction") ‖ bcs(rawTxn)), and verify the
      // returned signature against the public key with noble. A broken signing
      // path (wrong message, wrong key, garbage signature) fails this.
      globalThis.fetch.mockImplementation(async (url) => {
        const u = String(url)
        let body
        if (u.includes('/estimate_gas_price')) body = { gas_estimate: 100 }
        else if (u.endsWith('/accounts/' + ADDRESS)) body = { sequence_number: '11', authentication_key: ADDRESS }
        else if (u.includes('/transactions/simulate')) body = [{ success: true, vm_status: 'ok', gas_used: '50', gas_unit_price: '100' }]
        else body = {}
        return { ok: true, status: 200, statusText: 'OK', text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
      })

      const signed = await account.signTransaction({ to: RECIPIENT, value: 100000n })

      const { encodeEntryFunctionPayload, encodeAddressArg, encodeU64Arg, encodeRawTransaction, buildSigningMessage } = await import('../src/transaction.js')
      const { ed25519 } = await import('@noble/curves/ed25519')

      const payload = encodeEntryFunctionPayload({
        module: '0x1',
        moduleName: 'aptos_account',
        functionName: 'transfer',
        typeArgs: [],
        args: [encodeAddressArg(RECIPIENT), encodeU64Arg('100000')]
      })

      const rawTransaction = encodeRawTransaction({
        sender: ADDRESS,
        sequenceNumber: 11n,
        payload,
        maxGasAmount: BigInt(signed.max_gas_amount),
        gasUnitPrice: 100n,
        expirationTimestampSecs: BigInt(signed.expiration_timestamp_secs),
        chainId: 1
      })

      const message = buildSigningMessage(rawTransaction)
      const signatureBytes = hexToBytes(signed.signature.signature.slice(2))
      const publicKeyBytes = hexToBytes(signed.signature.public_key.slice(2))

      expect(ed25519.verify(signatureBytes, message, publicKeyBytes)).toBe(true)
    })
  })
})
