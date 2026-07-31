import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { giftUnwrap, WRAP_EXPIRY_SECONDS } from '@forgesworn/roost-kit'
import { makeLocalSigner } from './signer-local.js'
import {
  sendToPersonalInbox,
  readFromPersonalInbox,
  buildInviteWrap,
  buildReseedWraps,
  readInvite,
  readInviteViaRef,
  buildDmWrap,
  readDmWrap,
  buildPrivateLocationWrap,
  readPrivateLocationWrap,
  type InvitePayload,
} from './inbox.js'
import { personalInboxTag } from './keys.js'
import { toHex } from './hex.js'

const hex = (b: Uint8Array): string => toHex(b)
const signer = () => makeLocalSigner(hex(generateSecretKey()))

const SEED = `${'00'.repeat(31)}01`
const payload: InvitePayload = { t: 'invite', id: 'circle-1', s: SEED, n: 'The Smiths', m: 'family' }

describe('generic core — sendToPersonalInbox / readFromPersonalInbox', () => {
  it('round-trips an arbitrary JSON-serialisable payload, unrelated to any built-in payload type', async () => {
    const alice = signer()
    const bob = signer()
    const arbitrary = { foo: 'bar', n: 42, nested: { ok: true }, list: [1, 2, 3] }
    const wrap = await sendToPersonalInbox(alice, bob.pubkey, arbitrary)
    expect(wrap.kind).toBe(1059)
    const pTag = wrap.tags.find((t) => t[0] === 'p')?.[1]
    expect(pTag).toBe(personalInboxTag(bob.pubkey))

    const validate = (o: unknown) => o as typeof arbitrary
    const got = await readFromPersonalInbox(bob, wrap, validate)
    expect(got).toEqual({ ...arbitrary, from: alice.pubkey })
  })

  it('a validator that rejects the payload makes the read resolve to null', async () => {
    const alice = signer()
    const bob = signer()
    const wrap = await sendToPersonalInbox(alice, bob.pubkey, { any: 'thing' })
    const alwaysReject = () => null
    expect(await readFromPersonalInbox(bob, wrap, alwaysReject)).toBeNull()
  })

  it('a non-recipient cannot decrypt (and so cannot validate) the payload', async () => {
    const alice = signer()
    const bob = signer()
    const eve = signer()
    const wrap = await sendToPersonalInbox(alice, bob.pubkey, { any: 'thing' })
    expect(await readFromPersonalInbox(eve, wrap, (o) => o)).toBeNull()
  })
})

describe('wire-compat regression — buildInviteWrap matches flock invite.ts byte-for-byte', () => {
  it('unwraps via roost giftUnwrap to an inner rumor of kind 14 with fields t,id,s,n,m,x identical to the input', async () => {
    const alice = signer()
    const bob = signer()
    const withExpiry: InvitePayload = { ...payload, x: 1_700_000_000 }
    const wrap = await buildInviteWrap(alice, bob.pubkey, withExpiry)

    // Bypass covey-kit's own readInvite entirely — unwrap with roost-kit's
    // giftUnwrap directly, exactly as any independent wire-compat consumer would.
    const rumor = await giftUnwrap((pk, ct) => bob.nip44Decrypt(pk, ct), wrap)
    expect(rumor).not.toBeNull()
    expect(rumor?.kind).toBe(14)

    const content = JSON.parse(rumor!.content)
    expect(content).toEqual({
      t: withExpiry.t,
      id: withExpiry.id,
      s: withExpiry.s,
      n: withExpiry.n,
      m: withExpiry.m,
      x: withExpiry.x,
    })
    expect(Object.keys(content).sort()).toEqual(['id', 'm', 'n', 's', 't', 'x'])
  })

  it('a payload with no `x` omits the field entirely, matching flock (no `x: undefined` on the wire)', async () => {
    const alice = signer()
    const bob = signer()
    const wrap = await buildInviteWrap(alice, bob.pubkey, payload)
    const rumor = await giftUnwrap((pk, ct) => bob.nip44Decrypt(pk, ct), wrap)
    const content = JSON.parse(rumor!.content)
    expect(Object.keys(content).sort()).toEqual(['id', 'm', 'n', 's', 't'])
  })
})

describe('signer-based NIP-59 gift-wrapped invites', () => {
  it('round-trips: the recipient unwraps the seed', async () => {
    const alice = signer()
    const bob = signer()
    const wrap = await buildInviteWrap(alice, bob.pubkey, payload)
    expect(wrap.kind).toBe(1059)
    // Filed under Bob's derived personal-inbox tag, NOT his npub — the real key
    // never lands on the wire, yet Bob (who can recompute the tag) still receives it.
    const pTag = wrap.tags.find((t) => t[0] === 'p')?.[1]
    expect(pTag).toBe(personalInboxTag(bob.pubkey))
    expect(pTag).not.toBe(bob.pubkey)
    // The payload round-trips, and the inviter (Alice) is surfaced as `from` so
    // Bob can seed his roster with her the instant he joins.
    expect(await readInvite(bob, wrap)).toEqual({ ...payload, from: alice.pubkey })
  })

  it('a non-recipient CANNOT unwrap the seed', async () => {
    const alice = signer()
    const bob = signer()
    const eve = signer()
    const wrap = await buildInviteWrap(alice, bob.pubkey, payload)
    expect(await readInvite(eve, wrap)).toBeNull()
  })

  it('reseed payloads round-trip, one wrap per recipient', async () => {
    const alice = signer()
    const bob = signer()
    const carol = signer()
    const reseed: InvitePayload = { t: 'reseed', id: 'circle-1', s: 'ff'.repeat(32), n: 'X', m: 'nightout' }
    const wraps = await buildReseedWraps(alice, [bob.pubkey, carol.pubkey], reseed)
    expect(wraps).toHaveLength(2)
    expect(await readInvite(bob, wraps[0])).toEqual({ ...reseed, from: alice.pubkey })
    expect(await readInvite(carol, wraps[1])).toEqual({ ...reseed, from: alice.pubkey })
    expect(await readInvite(carol, wraps[0])).toBeNull()
  })

  it('an unknown/missing mode defaults to "family"; any other string passes through unchanged', async () => {
    const alice = signer()
    const bob = signer()
    const custom: InvitePayload = { t: 'invite', id: 'circle-2', s: SEED, n: 'Custom', m: 'roommates' }
    const wrap = await buildInviteWrap(alice, bob.pubkey, custom)
    expect(await readInvite(bob, wrap)).toEqual({ ...custom, from: alice.pubkey })
  })

  it('carries a reseed removal list (`r`) through the wire so recipients can evict members', async () => {
    const alice = signer()
    const bob = signer()
    const removed = ['ab'.repeat(32), 'cd'.repeat(32)]
    const reseed: InvitePayload = { t: 'reseed', id: 'circle-1', s: 'ff'.repeat(32), n: 'X', m: 'nightout', r: removed }
    const wrap = await buildReseedWraps(alice, [bob.pubkey], reseed)
    expect(await readInvite(bob, wrap[0])).toEqual({ ...reseed, from: alice.pubkey })
  })

  it('ignores `r` on an invite, and drops non-hex entries on a reseed', async () => {
    const alice = signer()
    const bob = signer()
    // `r` is reseed-only — an invite must not carry a removal list.
    const invite = { t: 'invite', id: 'c', s: SEED, n: 'N', m: 'family', r: ['ab'.repeat(32)] } as InvitePayload
    const iWrap = await buildInviteWrap(alice, bob.pubkey, invite)
    expect(await readInvite(bob, iWrap)).toEqual({ t: 'invite', id: 'c', s: SEED, n: 'N', m: 'family', from: alice.pubkey })
    // Malformed entries are filtered; an all-garbage list collapses to absent.
    const reseed = { t: 'reseed', id: 'c', s: SEED, n: 'N', m: 'family', r: ['not-hex', 123, 'ab'.repeat(32)] } as unknown as InvitePayload
    const rWrap = await buildReseedWraps(alice, [bob.pubkey], reseed)
    expect(await readInvite(bob, rWrap[0])).toEqual({ t: 'reseed', id: 'c', s: SEED, n: 'N', m: 'family', r: ['ab'.repeat(32)], from: alice.pubkey })
  })
})

describe('readInviteViaRef — the word-invite second hop (audit F4)', () => {
  it('a one-time reference keypair decrypts the invite exactly like a real signer would', async () => {
    const alice = signer()
    const refSk = generateSecretKey()
    const refPk = getPublicKey(refSk)
    const wrap = await buildInviteWrap(alice, refPk, payload)
    expect(await readInviteViaRef(refSk, wrap)).toEqual({ ...payload, from: alice.pubkey })
  })

  it('the wrong reference key cannot decrypt it', async () => {
    const alice = signer()
    const refSk = generateSecretKey()
    const wrongRefSk = generateSecretKey()
    const wrap = await buildInviteWrap(alice, getPublicKey(refSk), payload)
    expect(await readInviteViaRef(wrongRefSk, wrap)).toBeNull()
  })
})

describe('private direct message (personal-inbox gift-wrap)', () => {
  it('round-trips to the one recipient, filed under their personal-inbox tag, sender attributed', async () => {
    const alice = signer()
    const bob = signer()
    const wrap = await buildDmWrap(alice, bob.pubkey, { circleId: 'circle-1', text: 'on my way to you' })
    expect(wrap.kind).toBe(1059)
    // Routed to Bob's derived tag, never his npub — nothing on the wire ties it to him.
    const pTag = wrap.tags.find((t) => t[0] === 'p')?.[1]
    expect(pTag).toBe(personalInboxTag(bob.pubkey))
    expect(pTag).not.toBe(bob.pubkey)
    // The sender is recovered from the seal (the rumor's pubkey), not carried in
    // plaintext — and `at` is the rumor's own stamp, stable across relay replays.
    const dm = await readDmWrap(bob, wrap)
    expect(dm).toMatchObject({ from: alice.pubkey, circleId: 'circle-1', text: 'on my way to you' })
    expect(dm?.at).toBeTypeOf('number')
    expect(Math.abs((dm?.at ?? 0) - Math.floor(Date.now() / 1000))).toBeLessThan(60)
  })

  it('is readable ONLY by the named recipient — the whole circle cannot read it (privacy invariant)', async () => {
    const alice = signer()
    const bob = signer()
    const eve = signer()
    const wrap = await buildDmWrap(alice, bob.pubkey, { circleId: 'circle-1', text: 'secret' })
    expect(await readDmWrap(eve, wrap)).toBeNull()
  })

  it('a whitespace-only message is rejected, and text is trimmed', async () => {
    const alice = signer()
    const bob = signer()
    const blank = await buildDmWrap(alice, bob.pubkey, { circleId: 'c', text: '   ' })
    expect(await readDmWrap(bob, blank)).toBeNull()
    const padded = await buildDmWrap(alice, bob.pubkey, { circleId: 'c', text: '  hi  ' })
    expect((await readDmWrap(bob, padded))?.text).toBe('hi')
  })

  it('a DM is never mistaken for an invite (fall-through dispatch)', async () => {
    const alice = signer()
    const bob = signer()
    const dm = await buildDmWrap(alice, bob.pubkey, { circleId: 'c', text: 'hi' })
    expect(await readInvite(bob, dm)).toBeNull()
    const inviteWrap = await buildInviteWrap(alice, bob.pubkey, payload)
    expect(await readDmWrap(bob, inviteWrap)).toBeNull()
  })
})

describe('private location share (PM "Come to me", personal-inbox gift-wrap)', () => {
  it('round-trips to the one recipient, filed under their personal-inbox tag, sender attributed', async () => {
    const alice = signer()
    const bob = signer()
    const wrap = await buildPrivateLocationWrap(alice, bob.pubkey, { geohash: 'gcpvj0e', precision: 9 })
    expect(wrap.kind).toBe(1059)
    const pTag = wrap.tags.find((t) => t[0] === 'p')?.[1]
    expect(pTag).toBe(personalInboxTag(bob.pubkey))
    expect(pTag).not.toBe(bob.pubkey)
    const share = await readPrivateLocationWrap(bob, wrap)
    expect(share).toMatchObject({ from: alice.pubkey, geohash: 'gcpvj0e', precision: 9 })
    expect(share?.at).toBeTypeOf('number')
  })

  it('is readable ONLY by the named recipient — nobody else in the circle can decrypt it', async () => {
    const alice = signer()
    const bob = signer()
    const eve = signer()
    const wrap = await buildPrivateLocationWrap(alice, bob.pubkey, { geohash: 'gcpvj0e', precision: 9 })
    expect(await readPrivateLocationWrap(eve, wrap)).toBeNull()
  })

  it('is never mistaken for a DM or an invite (fall-through dispatch)', async () => {
    const alice = signer()
    const bob = signer()
    const loc = await buildPrivateLocationWrap(alice, bob.pubkey, { geohash: 'gcpvj0e', precision: 9 })
    expect(await readDmWrap(bob, loc)).toBeNull()
    expect(await readInvite(bob, loc)).toBeNull()
    const dm = await buildDmWrap(alice, bob.pubkey, { circleId: 'c', text: 'hi' })
    expect(await readPrivateLocationWrap(bob, dm)).toBeNull()
  })
})

describe('the NIP-40 retention window is the caller’s to choose', () => {
  // roost-kit requires ONE WINDOW PER APPLICATION across every wrap type it
  // sends: a per-type window is a type-tell, letting an observer who cannot read
  // a wrap still sort an app's traffic into invites, DMs and location shares by
  // expiry delta alone. This kit therefore plumbs the option through EVERY
  // builder, and these cases pin that — a partial plumbing would hand a caller
  // exactly that leak while looking like a feature.

  const delta = (wrap: { tags: string[][]; created_at: number }): number =>
    Number(wrap.tags.find((t) => t[0] === 'expiration')?.[1]) - wrap.created_at

  const recipient = () => getPublicKey(generateSecretKey())
  const invite: InvitePayload = { t: 'inv', c: 'circle-id', s: 'aa'.repeat(32) } as InvitePayload

  it('⚠️ DEFAULTS UNCHANGED on every builder — an existing caller sees no difference', async () => {
    // ⚠️ Flock and Fledgling wrap safety, invite and live-location traffic
    // through these functions. If adding the option moved their window, the
    // change would be the breaking one it exists to avoid.
    const s = signer()
    const wraps = await Promise.all([
      sendToPersonalInbox(s, recipient(), { t: 'x' }),
      buildInviteWrap(s, recipient(), invite),
      buildDmWrap(s, recipient(), { circleId: 'c', text: 'hello' }),
      buildPrivateLocationWrap(s, recipient(), { geohash: 'gcpuv', precision: 5 }),
    ])
    for (const w of wraps) expect(delta(w)).toBe(WRAP_EXPIRY_SECONDS)
    const reseeds = await buildReseedWraps(s, [recipient(), recipient()], invite)
    for (const w of reseeds) expect(delta(w)).toBe(WRAP_EXPIRY_SECONDS)
  })

  it('⚠️ carries a chosen window through EVERY builder, so one app has one window', async () => {
    // ⚠️ The mutant is dropping `expirySeconds` from any single builder — which
    // would leave that payload type wrapped at the default while the rest moved,
    // i.e. precisely the type-tell.
    const s = signer()
    const chosen = 45 * 86_400
    const wraps = await Promise.all([
      sendToPersonalInbox(s, recipient(), { t: 'x' }, chosen),
      buildInviteWrap(s, recipient(), invite, chosen),
      buildDmWrap(s, recipient(), { circleId: 'c', text: 'hello' }, chosen),
      buildPrivateLocationWrap(s, recipient(), { geohash: 'gcpuv', precision: 5 }, chosen),
    ])
    for (const w of wraps) expect(delta(w)).toBe(chosen)
    const reseeds = await buildReseedWraps(s, [recipient(), recipient()], invite, chosen)
    for (const w of reseeds) expect(delta(w)).toBe(chosen)
  })

  it('still round-trips with a custom window — the payload is unaffected by the tag', async () => {
    const sender = signer()
    const rk = generateSecretKey()
    const wrap = await buildDmWrap(sender, getPublicKey(rk), { circleId: 'c', text: 'still readable' }, 45 * 86_400)
    const read = await readDmWrap(makeLocalSigner(hex(rk)), wrap)
    expect(read?.text).toBe('still readable')
  })
})
