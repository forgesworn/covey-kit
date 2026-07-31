// Personal-inbox gift-wrapped payloads — invites/reseeds, direct messages, and
// private location shares, all sent to ONE recipient's real key but filed at
// the relay under their derived `personalInboxTag` (never their npub).
//
// Ported from flock's `app/src/invite.ts`, REFACTORED per the extraction
// analysis (flock-extraction-analysis.md §7): flock's file bundled four
// distinct payload types (invite/reseed, an EXACT meeting-point share, a DM,
// and a private location share) on the same "gift-wrap to inner kind 14,
// routed via personalInboxTag" mechanism, each a thin wrapper repeating that
// pattern. Here that mechanism is pulled out as a generic core —
// `sendToPersonalInbox`/`readFromPersonalInbox` — and every payload type below
// is built on top of it. `buildMeetingExactWrap`/`readMeetingExactWrap` are
// NOT ported: `MeetingShare` is a flock-domain type (meeting-point rendezvous)
// that isn't part of a standalone circle-lifecycle kit (see analysis §7 point 2).
//
// Wire format is unchanged from flock: inner rumor `kind: 14`, route tag
// `personalInboxTag(recipientPk)`, same JSON payload shapes — only the internal
// TypeScript factoring differs.

import { giftWrap, giftUnwrap, rawNip44Decrypt, WRAP_EXPIRY_SECONDS } from '@forgesworn/roost-kit'
import type { Signer, SignedEvent, Rumor } from '@forgesworn/roost-kit'
import { personalInboxTag } from './keys.js'

const RUMOR_KIND = 14

// ---------------------------------------------------------------------------
// Generic core — the shared "gift-wrap a JSON payload to one recipient's
// personal inbox" mechanism every payload type below is built on.
// ---------------------------------------------------------------------------

/** Gift-wrap an arbitrary JSON-serialisable payload to a recipient's personal
 *  inbox. Encrypted to their real key (via the signer); filed at the relay
 *  under `personalInboxTag(recipientPk)` so the npub itself never lands on
 *  the wire. Inner rumor is always `kind: 14`, discriminated by the payload's
 *  own shape (e.g. a `t` field) on the way back out.
 *
 *  `expirySeconds` is the NIP-40 retention window, defaulting to roost-kit's
 *  `WRAP_EXPIRY_SECONDS` so an existing caller is unaffected. It is plumbed
 *  through EVERY builder in this file rather than only the ones that seemed to
 *  need it, and that is the point: roost-kit requires ONE WINDOW PER
 *  APPLICATION across every wrap type it sends, because a per-type window is a
 *  type-tell — an observer who cannot read a wrap could still sort an app's
 *  traffic into invites, DMs and location shares by expiry delta alone. A
 *  partial plumbing would hand a caller exactly that leak while looking like a
 *  feature. */
export function sendToPersonalInbox(
  signer: Signer,
  recipientPk: string,
  payload: unknown,
  expirySeconds?: number,
): Promise<SignedEvent> {
  return giftWrap(
    signer,
    recipientPk,
    { kind: RUMOR_KIND, content: JSON.stringify(payload), tags: [] },
    personalInboxTag(recipientPk),
    expirySeconds ?? WRAP_EXPIRY_SECONDS,
  )
}

/** Unwrap + decrypt with `decrypt`, then hand the rumor to `parse` (already
 *  inside a try/catch, so a malformed payload just resolves to null instead
 *  of throwing). Shared plumbing for every read function below — the only
 *  thing that varies per payload type is `parse`. */
async function unwrapAndParse<T>(
  decrypt: (peerPk: string, ciphertext: string) => Promise<string> | string,
  wrap: { pubkey: string; content: string },
  parse: (rumor: Rumor) => T | null,
): Promise<T | null> {
  const rumor = await giftUnwrap(decrypt, wrap)
  if (!rumor) return null
  try {
    return parse(rumor)
  } catch {
    return null
  }
}

/** Unwrap a personal-inbox wrap addressed to us (via the signer), JSON-parse
 *  its content, and hand it to `validate`. Returns the validated payload plus
 *  `from` (the seal's real pubkey — the sender) on success, or null if the
 *  wrap isn't ours, isn't decryptable, or fails validation. */
export async function readFromPersonalInbox<T>(
  signer: Signer,
  wrap: { pubkey: string; content: string },
  validate: (o: unknown) => T | null,
): Promise<(T & { from: string }) | null> {
  return unwrapAndParse(
    (pk, ct) => signer.nip44Decrypt(pk, ct),
    wrap,
    (rumor) => {
      const valid = validate(JSON.parse(rumor.content))
      return valid ? { ...valid, from: rumor.pubkey } : null
    },
  )
}

// ---------------------------------------------------------------------------
// Invite / reseed
// ---------------------------------------------------------------------------

export interface InvitePayload {
  t: 'invite' | 'reseed'
  id: string
  s: string // seed hex
  n: string // circle name
  m: string // circle mode — a flock-specific 'family'|'nightout' union upstream; generalised to `string` here (see task 7 brief)
  x?: number // transient expiry (unix sec), if any
  r?: string[] // reseed only: member pubkeys removed in/before this reseed. A durable
                // removal marker — a recipient drops these from its roster so a rotated
                // seed is never re-wrapped back to an evicted member. Additive & optional:
                // older clients ignore it (they still adopt the new seed).
}

const SEED_RE = /^[0-9a-f]{64}$/

/** Shared validator for both invite unwrap paths below — the payload shape is
 *  identical either way; only the decryption key's origin differs. Unknown/
 *  missing `m` defaults to `'family'` (flock's own default), but any other
 *  string passes through unchanged now that `m` is generalised. */
function validateInvitePayload(o: unknown): InvitePayload | null {
  if (typeof o !== 'object' || o === null) return null
  const r = o as Record<string, unknown>
  if ((r.t === 'invite' || r.t === 'reseed') && typeof r.id === 'string' && typeof r.s === 'string' && SEED_RE.test(r.s)) {
    const removed = r.t === 'reseed' && Array.isArray(r.r)
      ? r.r.filter((x): x is string => typeof x === 'string' && SEED_RE.test(x))
      : []
    return {
      t: r.t,
      id: r.id,
      s: r.s,
      n: typeof r.n === 'string' ? r.n : 'Circle',
      m: typeof r.m === 'string' ? r.m : 'family',
      ...(typeof r.x === 'number' ? { x: r.x } : {}),
      ...(removed.length ? { r: removed } : {}),
    }
  }
  return null
}

/** Gift-wrap an invite/reseed payload to a single recipient pubkey via the signer.
 *  Encrypted to their real key; filed at the relay under `personalInboxTag` so the
 *  npub itself is never exposed. */
export function buildInviteWrap(
  signer: Signer,
  recipientPk: string,
  payload: InvitePayload,
  expirySeconds?: number,
): Promise<SignedEvent> {
  return sendToPersonalInbox(signer, recipientPk, payload, expirySeconds)
}

/** Gift-wrap a reseed payload to many recipients. */
export function buildReseedWraps(
  signer: Signer,
  recipientPks: string[],
  payload: InvitePayload,
  expirySeconds?: number,
): Promise<SignedEvent[]> {
  return Promise.all(recipientPks.map((pk) => buildInviteWrap(signer, pk, payload, expirySeconds)))
}

/** Unwrap a gift wrap addressed to us (via the signer); returns the invite payload
 *  plus `from` (the inviter/reseeder — the seal's real pubkey) or null. Surfacing the
 *  sender lets a fresh joiner seed their roster with the inviter immediately, so a
 *  message from them the moment they join isn't dropped as an unknown sender. */
export function readInvite(signer: Signer, wrap: { pubkey: string; content: string }): Promise<(InvitePayload & { from: string }) | null> {
  return readFromPersonalInbox(signer, wrap, validateInvitePayload)
}

/** Unwrap an invite gift-wrap using a raw secret key instead of a member's real
 *  signer — the word-invite second hop: the invite is addressed to a one-time
 *  REFERENCE keypair handed over by the low-entropy spoken code, not to a real
 *  identity, so there is no Signer to ask. Same payload shape, same privacy
 *  guarantee — only the decryption key's origin differs. */
export async function readInviteViaRef(refSk: Uint8Array, wrap: { pubkey: string; content: string }): Promise<(InvitePayload & { from: string }) | null> {
  return unwrapAndParse(rawNip44Decrypt(refSk), wrap, (rumor) => {
    const valid = validateInvitePayload(JSON.parse(rumor.content))
    return valid ? { ...valid, from: rumor.pubkey } : null
  })
}

// ---------------------------------------------------------------------------
// Direct message
// ---------------------------------------------------------------------------

// A private DIRECT MESSAGE to ONE member — free text, encrypted to their real key
// and filed under their personal-inbox tag, exactly like an invite. It deliberately
// does NOT ride the shared circle inbox: only the named recipient can read it, so
// "message just this person" is honest on the wire. Same rumour kind as invites;
// distinguished by the payload `t`. The sender is recovered from the seal (the
// rumor's real pubkey), never carried in plaintext.
interface DmPayload { t: 'dm'; c: string; text: string }

/** A decrypted direct message: who sent it, which circle it belongs to, the text,
 *  and when (the rumor's own created_at — stable across relay replays, which is
 *  what lets the chat thread deduplicate an echoed wrap). */
export interface DirectMessage { from: string; circleId: string; text: string; at: number }

// A single wrap can't carry a novel, and an oversized message is a memory/notify
// hazard — bound it. Trimmed on the way out so a fat paste can't smuggle length.
const MAX_DM_LEN = 500

/** Gift-wrap a private direct message to one recipient. Encrypted to their real key;
 *  filed under `personalInboxTag` so the npub stays off the wire. Only they can read it. */
export function buildDmWrap(
  signer: Signer,
  recipientPk: string,
  msg: { circleId: string; text: string },
  expirySeconds?: number,
): Promise<SignedEvent> {
  const payload: DmPayload = { t: 'dm', c: msg.circleId, text: msg.text.trim().slice(0, MAX_DM_LEN) }
  return sendToPersonalInbox(signer, recipientPk, payload, expirySeconds)
}

/** Unwrap a personal-inbox wrap as a direct message; null if it isn't one (or isn't
 *  addressed to us, or is empty). The sender is the seal's real pubkey. `at` comes
 *  from the rumor's own created_at, not the JSON payload, so it isn't exposed via
 *  the generic `readFromPersonalInbox<T>` helper — hence the direct `unwrapAndParse`. */
export function readDmWrap(signer: Signer, wrap: { pubkey: string; content: string }): Promise<DirectMessage | null> {
  return unwrapAndParse(
    (pk, ct) => signer.nip44Decrypt(pk, ct),
    wrap,
    (rumor) => {
      const o = JSON.parse(rumor.content) as Record<string, unknown>
      if (o.t !== 'dm' || typeof o.c !== 'string' || typeof o.text !== 'string') return null
      const text = o.text.trim().slice(0, MAX_DM_LEN)
      if (!text) return null
      return { from: rumor.pubkey, circleId: o.c, text, at: rumor.created_at }
    },
  )
}

// ---------------------------------------------------------------------------
// Private location share
// ---------------------------------------------------------------------------

// A private "Come to me" from a PM: a ONE-SHOT exact location, gift-wrapped to
// ONE recipient's personal inbox — never the shared circle inbox, so nobody
// else in the circle ever sees it. Same rumour kind and personal-inbox channel
// as a DM; distinguished by payload `t`. Encoding stays at the edge (the geohash
// arrives already encoded), same discipline as every other flock beacon.
interface LocationSharePayload { t: 'loc'; geohash: string; precision: number }

/** A decrypted private location share: who sent it, their encoded cell, its
 *  precision, and when (the rumor's own created_at). */
export interface PrivateLocationShare { from: string; geohash: string; precision: number; at: number }

/** Gift-wrap a one-shot exact location to one recipient. Encrypted to their real
 *  key; filed under `personalInboxTag` so the npub stays off the wire. Only they
 *  can read it — it never rides the circle's shared inbox. */
export function buildPrivateLocationWrap(
  signer: Signer,
  recipientPk: string,
  share: { geohash: string; precision: number },
  expirySeconds?: number,
): Promise<SignedEvent> {
  const payload: LocationSharePayload = { t: 'loc', geohash: share.geohash, precision: share.precision }
  return sendToPersonalInbox(signer, recipientPk, payload, expirySeconds)
}

/** Unwrap a personal-inbox wrap as a private location share; null if it isn't
 *  one (or isn't addressed to us, or is malformed). The sender is the seal's
 *  real pubkey; `at` comes from the rumor's own created_at (see readDmWrap). */
export function readPrivateLocationWrap(signer: Signer, wrap: { pubkey: string; content: string }): Promise<PrivateLocationShare | null> {
  return unwrapAndParse(
    (pk, ct) => signer.nip44Decrypt(pk, ct),
    wrap,
    (rumor) => {
      const o = JSON.parse(rumor.content) as Record<string, unknown>
      if (o.t !== 'loc' || typeof o.geohash !== 'string' || typeof o.precision !== 'number') return null
      return { from: rumor.pubkey, geohash: o.geohash, precision: o.precision, at: rumor.created_at }
    },
  )
}
