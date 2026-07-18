import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { LocalSigner, makeLocalSigner } from './signer-local.js'
import { toHex } from './hex.js'

// flock has no standalone signer.test.ts of its own — LocalSigner there is
// only exercised indirectly via invite.test.ts. Since LocalSigner is now a
// public covey-kit export implementing roost-kit's `Signer` contract, it gets
// direct coverage here.

const hex = (b: Uint8Array): string => toHex(b)

describe('LocalSigner (roost-kit Signer implementation)', () => {
  it('derives its pubkey from the hex secret key', () => {
    const sk = generateSecretKey()
    const signer = new LocalSigner(hex(sk))
    expect(signer.pubkey).toBe(getPublicKey(sk))
  })

  it('signEvent produces a validly signed event, defaulting created_at to now', async () => {
    const signer = makeLocalSigner(hex(generateSecretKey()))
    const ev = await signer.signEvent({ kind: 1, content: 'hi', tags: [] })
    expect(ev.pubkey).toBe(signer.pubkey)
    expect(verifyEvent(ev as any)).toBe(true)
    expect(Math.abs(ev.created_at - Math.floor(Date.now() / 1000))).toBeLessThan(5)
  })

  it('signEvent honours an explicit created_at', async () => {
    const signer = makeLocalSigner(hex(generateSecretKey()))
    const ev = await signer.signEvent({ kind: 1, content: '', tags: [], created_at: 1_700_000_000 })
    expect(ev.created_at).toBe(1_700_000_000)
  })

  it('nip44Encrypt/nip44Decrypt round-trip between two signers', async () => {
    const alice = makeLocalSigner(hex(generateSecretKey()))
    const bob = makeLocalSigner(hex(generateSecretKey()))
    const ct = await alice.nip44Encrypt(bob.pubkey, 'secret message')
    expect(await bob.nip44Decrypt(alice.pubkey, ct)).toBe('secret message')
  })

  it('exposes secretKeyHex as the escape hatch used by the gift-wrap path', () => {
    const skHex = hex(generateSecretKey())
    const signer = new LocalSigner(skHex)
    expect(signer.secretKeyHex).toBe(skHex)
  })
})
