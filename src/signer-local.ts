// LocalSigner — the local-key backend for roost-kit's `Signer` interface.
//
// Ported from flock's `app/src/signer.ts`. flock also shipped a
// `makeSignetSigner` backend there (key in a remote NIP-46 signer — Signet, a
// NIP-07 extension, Amber, or any `bunker://` — adapting signet-login's
// `SignetSigner` to the same interface). That backend is NOT ported here:
// v1 is LocalSigner only (global-constraints.md: "No makeSignetSigner/
// signet-login in v1"). roost-kit's `Signer` interface is the seam a future
// signet-login-backed implementation would plug into, exactly as
// makeSignetSigner did against flock's FlockSigner.

import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { getConversationKey, encrypt as nip44encrypt, decrypt as nip44decrypt } from 'nostr-tools/nip44'
import type { Signer, SignedEvent, EventTemplate } from '@forgesworn/roost-kit'
import { fromHex } from './hex.js'

const nowSec = (): number => Math.floor(Date.now() / 1000)

/** Local-key signer — the caller hands it a hex secret key and owns wherever
 *  that key is actually persisted (kit purity: no localStorage/DOM here). */
export class LocalSigner implements Signer {
  readonly pubkey: string
  constructor(private readonly skHex: string) {
    this.pubkey = getPublicKey(fromHex(skHex))
  }

  signEvent(template: EventTemplate): Promise<SignedEvent> {
    const t = { ...template, created_at: template.created_at ?? nowSec() }
    return Promise.resolve(finalizeEvent(t, fromHex(this.skHex)) as unknown as SignedEvent)
  }

  nip44Encrypt(peerPubkey: string, plaintext: string): Promise<string> {
    return Promise.resolve(nip44encrypt(plaintext, getConversationKey(fromHex(this.skHex), peerPubkey)))
  }

  nip44Decrypt(peerPubkey: string, ciphertext: string): Promise<string> {
    return Promise.resolve(nip44decrypt(ciphertext, getConversationKey(fromHex(this.skHex), peerPubkey)))
  }

  /** WIP escape hatch for the gift-wrap path until SignetSigner-based wrapping lands. */
  get secretKeyHex(): string { return this.skHex }
}

export function makeLocalSigner(skHex: string): Signer {
  return new LocalSigner(skHex)
}
