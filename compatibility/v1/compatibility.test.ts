import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildInviteWrap,
  buildReseedWraps,
  createCircle,
  deriveCircleSeed,
  deriveInbox,
  deriveWordCodeSeed,
  LocalSigner,
  mergeConfig,
  personalInboxTag,
  readInvite,
  wordCodeFromEntropy,
  wordInviteParkKey,
  wordInviteTag,
  type CircleMember,
  type InvitePayload,
} from '../../src/index.js'

interface CompatibilityVectors {
  keys: {
    rootHex: string
    circleId: string
    epochs: Array<{ epoch: number; seedHex: string }>
    inboxSeedHex: string
    inboxSecretHex: string
    inboxPublicHex: string
    personalPubkey: string
    personalInboxTag: string
  }
  wordCode: {
    entropy: number[]
    words: string[]
    seedHex: string
    inviteTag: string
    parkSecretHex: string
  }
  circle: { name: string; nowSec: number; creator: CircleMember }
  personalInbox: {
    senderSecret: string
    senderPublic: string
    recipientSecret: string
    recipientPublic: string
    wrongSecret: string
    routeTag: string
    invite: InvitePayload
    reseed: InvitePayload
  }
}

const vectorsPath = fileURLToPath(new URL('./vectors.json', import.meta.url))
const vectors = JSON.parse(readFileSync(vectorsPath, 'utf8')) as CompatibilityVectors
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

describe('Covey public compatibility vectors v1', () => {
  it('preserves circle, inbox and personal-route derivation', () => {
    for (const vector of vectors.keys.epochs) {
      expect(deriveCircleSeed(vectors.keys.rootHex, vectors.keys.circleId, vector.epoch)).toBe(vector.seedHex)
    }
    const inbox = deriveInbox(vectors.keys.inboxSeedHex)
    expect(hex(inbox.sk)).toBe(vectors.keys.inboxSecretHex)
    expect(inbox.pk).toBe(vectors.keys.inboxPublicHex)
    expect(personalInboxTag(vectors.keys.personalPubkey)).toBe(vectors.keys.personalInboxTag)
  })

  it('preserves six-word rendezvous derivation', async () => {
    const vector = vectors.wordCode
    const words = wordCodeFromEntropy(Uint8Array.from(vector.entropy))
    expect(words).toEqual(vector.words)
    const seed = await deriveWordCodeSeed(words)
    expect(seed).toBe(vector.seedHex)
    expect(wordInviteTag(seed)).toBe(vector.inviteTag)
    expect(hex(wordInviteParkKey(seed))).toBe(vector.parkSecretHex)
  })

  it('preserves circle creation and latest-wins merge clocks', () => {
    const vector = vectors.circle
    const circle = createCircle({
      id: vectors.keys.circleId,
      name: vector.name,
      rootHex: vectors.keys.rootHex,
      creator: vector.creator,
      nowSec: vector.nowSec,
    })
    expect(circle).toMatchObject({
      id: vectors.keys.circleId,
      seedHex: vectors.keys.epochs[0]?.seedHex,
      members: [vector.creator],
      configUpdatedAt: vector.nowSec,
      configBy: vector.creator.pk,
    })

    const incoming = {
      v: 1 as const,
      id: circle.id,
      name: 'Merged circle',
      members: circle.members,
      updatedAt: vector.nowSec + 1,
      by: vector.creator.pk,
    }
    expect(mergeConfig(circle, incoming)).toMatchObject({
      name: incoming.name,
      configUpdatedAt: incoming.updatedAt,
      configBy: incoming.by,
    })
  })

  it('preserves personal-inbox invite and reseed semantics', async () => {
    const vector = vectors.personalInbox
    const sender = new LocalSigner(vector.senderSecret)
    const recipient = new LocalSigner(vector.recipientSecret)
    const wrongRecipient = new LocalSigner(vector.wrongSecret)

    expect(sender.pubkey).toBe(vector.senderPublic)
    expect(recipient.pubkey).toBe(vector.recipientPublic)

    const inviteWrap = await buildInviteWrap(sender, recipient.pubkey, vector.invite)
    expect(inviteWrap.tags.find((tag) => tag[0] === 'p')?.[1]).toBe(vector.routeTag)
    expect(await readInvite(recipient, inviteWrap)).toEqual({ ...vector.invite, from: sender.pubkey })
    expect(await readInvite(wrongRecipient, inviteWrap)).toBeNull()

    const [reseedWrap] = await buildReseedWraps(sender, [recipient.pubkey], vector.reseed)
    expect(reseedWrap).toBeDefined()
    expect(await readInvite(recipient, reseedWrap!)).toEqual({ ...vector.reseed, from: sender.pubkey })
  })
})
