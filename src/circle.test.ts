import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCircle,
  circleFromInvite,
  applyReseed,
  upsertMember,
  removeMember,
  buildConfig,
  mergeConfig,
  guardians,
  isGuardian,
  type Circle,
  type CircleMember,
  type CircleConfig,
} from './circle.js'

const testCreator: CircleMember = { pk: '0000000000000000000000000000000000000000000000000000000000000001', role: 'guardian', name: 'Creator' }
const testChild: CircleMember = { pk: '0000000000000000000000000000000000000000000000000000000000000002', role: 'child', name: 'Child' }
const testPeer: CircleMember = { pk: '0000000000000000000000000000000000000000000000000000000000000003', role: 'peer', name: 'Peer' }
const testRootHex = '8000000000000000000000000000000000000000000000000000000000000000'
const testId = 'test-circle'
const testNow = 1000

describe('circle state', () => {
  describe('createCircle', () => {
    it('creates a new circle with seedHex derived from rootHex', () => {
      const circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      expect(circle.id).toBe(testId)
      expect(circle.name).toBe('Test')
      expect(circle.seedHex).toHaveLength(64) // hex string for a seed
      expect(circle.epoch).toBe(0)
      expect(circle.members).toEqual([testCreator])
      expect(circle.createdAt).toBe(testNow)
      expect(circle.configUpdatedAt).toBe(testNow)
      expect(circle.configBy).toBe(testCreator.pk)
      expect(circle.reseededAt).toBeUndefined()
      expect(circle.expiresAt).toBeUndefined()
    })

    it('produces a deterministic seedHex (reproducible with same inputs)', () => {
      const c1 = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      const c2 = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      expect(c1.seedHex).toBe(c2.seedHex)
    })

    it('differs seedHex for different circle IDs', () => {
      const c1 = createCircle({ id: 'circle1', name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      const c2 = createCircle({ id: 'circle2', name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      expect(c1.seedHex).not.toBe(c2.seedHex)
    })
  })

  describe('circleFromInvite', () => {
    it('creates a circle from invite data with member as self', () => {
      const inviteData = { id: testId, s: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234', n: 'Invited Circle' }
      const circle = circleFromInvite(inviteData, testChild, testNow)
      expect(circle.id).toBe(testId)
      expect(circle.name).toBe('Invited Circle')
      expect(circle.seedHex).toBe(inviteData.s)
      expect(circle.epoch).toBe(0)
      expect(circle.members).toEqual([testChild])
      expect(circle.createdAt).toBe(testNow)
      expect(circle.configUpdatedAt).toBe(testNow)
      expect(circle.configBy).toBe(testChild.pk)
    })
  })

  describe('applyReseed', () => {
    let baseCircle: Circle

    beforeEach(() => {
      baseCircle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
    })

    it('increments epoch and updates seedHex', () => {
      const newSeed = 'f000000000000000000000000000000000000000000000000000000000000000'
      const reseeded = applyReseed(baseCircle, { id: testId, s: newSeed }, testNow + 100)
      expect(reseeded.epoch).toBe(1)
      expect(reseeded.seedHex).toBe(newSeed)
      expect(reseeded.reseededAt).toBe(testNow + 100)
    })

    it('sets reseededAt to nowSec', () => {
      const newSeed = 'f000000000000000000000000000000000000000000000000000000000000000'
      const reseeded = applyReseed(baseCircle, { id: testId, s: newSeed }, testNow + 200)
      expect(reseeded.reseededAt).toBe(testNow + 200)
    })

    it('preserves members and other circle state', () => {
      const updated = upsertMember(baseCircle, testChild, testCreator.pk, testNow)
      const newSeed = 'f000000000000000000000000000000000000000000000000000000000000000'
      const reseeded = applyReseed(updated, { id: testId, s: newSeed }, testNow + 100)
      expect(reseeded.members).toContainEqual(testCreator)
      expect(reseeded.members).toContainEqual(testChild)
      expect(reseeded.members.length).toBe(2)
    })

    it('returns new circle, does not mutate input', () => {
      const originalSeed = baseCircle.seedHex
      const newSeed = 'f000000000000000000000000000000000000000000000000000000000000000'
      applyReseed(baseCircle, { id: testId, s: newSeed }, testNow + 100)
      expect(baseCircle.seedHex).toBe(originalSeed)
      expect(baseCircle.epoch).toBe(0)
    })
  })

  describe('upsertMember', () => {
    let baseCircle: Circle

    beforeEach(() => {
      baseCircle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
    })

    it('adds a new member to the circle', () => {
      const updatedAt = testNow + 50
      const updated = upsertMember(baseCircle, testChild, testCreator.pk, updatedAt)
      expect(updated.members).toHaveLength(2)
      expect(updated.members).toContainEqual(testChild)
      expect(updated.configUpdatedAt).toBe(updatedAt)
      expect(updated.configBy).toBe(testCreator.pk)
    })

    it('updates an existing member (by pk)', () => {
      const updated = upsertMember(baseCircle, testChild, testCreator.pk, testNow)
      const modified: CircleMember = { ...testChild, name: 'Child Updated' }
      const updated2 = upsertMember(updated, modified, testCreator.pk, testNow + 50)
      expect(updated2.members).toHaveLength(2)
      const found = updated2.members.find((m) => m.pk === testChild.pk)
      expect(found?.name).toBe('Child Updated')
    })

    it('returns new circle, does not mutate input', () => {
      const originalMembers = [...baseCircle.members]
      upsertMember(baseCircle, testChild, testCreator.pk, testNow)
      expect(baseCircle.members).toEqual(originalMembers)
    })

    it('does not mutate the input member', () => {
      const memberCopy = { ...testChild }
      upsertMember(baseCircle, testChild, testCreator.pk, testNow)
      expect(testChild).toEqual(memberCopy)
    })
  })

  describe('removeMember', () => {
    let baseCircle: Circle

    beforeEach(() => {
      const temp = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      baseCircle = upsertMember(temp, testChild, testCreator.pk, testNow)
      baseCircle = upsertMember(baseCircle, testPeer, testCreator.pk, testNow)
    })

    it('removes a member by pk', () => {
      const updatedAt = testNow + 50
      const updated = removeMember(baseCircle, testChild.pk, testCreator.pk, updatedAt)
      expect(updated.members).toHaveLength(2)
      expect(updated.members).toContainEqual(testCreator)
      expect(updated.members).toContainEqual(testPeer)
      expect(updated.members.find((m) => m.pk === testChild.pk)).toBeUndefined()
      expect(updated.configUpdatedAt).toBe(updatedAt)
      expect(updated.configBy).toBe(testCreator.pk)
    })

    it('returns new circle, does not mutate input', () => {
      const originalLength = baseCircle.members.length
      removeMember(baseCircle, testChild.pk, testCreator.pk, testNow)
      expect(baseCircle.members.length).toBe(originalLength)
    })

    it('does nothing if pk not found', () => {
      const updated = removeMember(baseCircle, '9999999999999999999999999999999999999999999999999999999999999999', testCreator.pk, testNow)
      expect(updated).toBe(baseCircle)
    })
  })

  describe('buildConfig', () => {
    it('builds a CircleConfig from a Circle', () => {
      const circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      const config = buildConfig(circle)
      expect(config.v).toBe(1)
      expect(config.id).toBe(circle.id)
      expect(config.name).toBe(circle.name)
      expect(config.members).toEqual(circle.members)
      expect(config.updatedAt).toBe(circle.configUpdatedAt)
      expect(config.by).toBe(circle.configBy)
    })
  })

  describe('mergeConfig', () => {
    let baseCircle: Circle

    beforeEach(() => {
      baseCircle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
    })

    it('applies a newer config', () => {
      const incomingConfig: CircleConfig = {
        v: 1,
        id: testId,
        name: 'Updated Name',
        members: [testCreator, testChild],
        updatedAt: testNow + 100,
        by: testCreator.pk,
      }
      const merged = mergeConfig(baseCircle, incomingConfig)
      expect(merged.name).toBe('Updated Name')
      expect(merged.members).toEqual([testCreator, testChild])
      expect(merged.configUpdatedAt).toBe(testNow + 100)
    })

    it('ignores an older config', () => {
      const baseConfig = buildConfig(baseCircle)
      const incomingConfig: CircleConfig = {
        v: 1,
        id: testId,
        name: 'Old Name',
        members: [testCreator, testChild],
        updatedAt: testNow - 100,
        by: testChild.pk,
      }
      const merged = mergeConfig(baseCircle, incomingConfig)
      expect(merged).toEqual(baseCircle) // unchanged
    })

    it('uses tie-break: lexicographically smaller `by` wins on equal updatedAt', () => {
      const smallerByConfig: CircleConfig = {
        v: 1,
        id: testId,
        name: 'Smaller By',
        members: [testCreator, testChild],
        updatedAt: testNow + 100,
        by: '0000000000000000000000000000000000000000000000000000000000000001', // smaller
      }
      const largerByConfig: CircleConfig = {
        v: 1,
        id: testId,
        name: 'Larger By',
        members: [testCreator],
        updatedAt: testNow + 100,
        by: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // larger
      }

      // Start with larger-by config
      let merged = mergeConfig(baseCircle, largerByConfig)
      expect(merged.name).toBe('Larger By')

      // Apply smaller-by config with same timestamp — should win
      merged = mergeConfig(merged, smallerByConfig)
      expect(merged.name).toBe('Smaller By')

      // Apply larger-by again — should be ignored
      merged = mergeConfig(merged, largerByConfig)
      expect(merged.name).toBe('Smaller By')
    })

    it('ignores malformed configs (invalid JSON)', () => {
      const original = baseCircle
      const result = mergeConfig(original, 'not valid json')
      expect(result).toEqual(original)
    })

    it('ignores config with id mismatch', () => {
      const incomingConfig: CircleConfig = {
        v: 1,
        id: 'different-id',
        name: 'Updated Name',
        members: [testCreator],
        updatedAt: testNow + 100,
        by: testCreator.pk,
      }
      const merged = mergeConfig(baseCircle, incomingConfig)
      expect(merged).toEqual(baseCircle)
    })

    it('ignores config with bad role in members', () => {
      const incomingConfig: unknown = {
        v: 1,
        id: testId,
        name: 'Updated Name',
        members: [{ pk: testCreator.pk, role: 'invalid-role', name: 'Bad' }],
        updatedAt: testNow + 100,
        by: testCreator.pk,
      }
      const merged = mergeConfig(baseCircle, incomingConfig)
      expect(merged).toEqual(baseCircle)
    })

    it('ignores config with non-64-hex pubkey', () => {
      const incomingConfig: unknown = {
        v: 1,
        id: testId,
        name: 'Updated Name',
        members: [{ pk: 'not-a-hex-key', role: 'guardian' }],
        updatedAt: testNow + 100,
        by: testCreator.pk,
      }
      const merged = mergeConfig(baseCircle, incomingConfig)
      expect(merged).toEqual(baseCircle)
    })

    it('returns new circle, does not mutate input', () => {
      const incomingConfig: CircleConfig = {
        v: 1,
        id: testId,
        name: 'Updated Name',
        members: [testCreator, testChild],
        updatedAt: testNow + 100,
        by: testCreator.pk,
      }
      const originalName = baseCircle.name
      mergeConfig(baseCircle, incomingConfig)
      expect(baseCircle.name).toBe(originalName)
    })
  })

  describe('guardians', () => {
    it('returns all guardian members', () => {
      let circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      circle = upsertMember(circle, testChild, testCreator.pk, testNow)
      circle = upsertMember(circle, testPeer, testCreator.pk, testNow)
      const guardiansList = guardians(circle)
      expect(guardiansList).toEqual([testCreator])
    })

    it('returns empty array if no guardians', () => {
      const nonGuardian: CircleMember = { pk: '9999999999999999999999999999999999999999999999999999999999999999', role: 'peer' }
      const circle = circleFromInvite({ id: testId, s: 'a'.repeat(64), n: 'Test' }, nonGuardian, testNow)
      const guardiansList = guardians(circle)
      expect(guardiansList).toEqual([])
    })

    it('returns multiple guardians if present', () => {
      const guardian2: CircleMember = { pk: '0000000000000000000000000000000000000000000000000000000000000004', role: 'guardian', name: 'Guardian 2' }
      let circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      circle = upsertMember(circle, guardian2, testCreator.pk, testNow)
      circle = upsertMember(circle, testChild, testCreator.pk, testNow)
      const guardiansList = guardians(circle)
      expect(guardiansList).toHaveLength(2)
      expect(guardiansList).toContainEqual(testCreator)
      expect(guardiansList).toContainEqual(guardian2)
    })
  })

  describe('isGuardian', () => {
    it('returns true for a guardian member', () => {
      const circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      expect(isGuardian(circle, testCreator.pk)).toBe(true)
    })

    it('returns false for non-guardian members', () => {
      let circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      circle = upsertMember(circle, testChild, testCreator.pk, testNow)
      expect(isGuardian(circle, testChild.pk)).toBe(false)
    })

    it('returns false for non-existent members', () => {
      const circle = createCircle({ id: testId, name: 'Test', rootHex: testRootHex, creator: testCreator, nowSec: testNow })
      expect(isGuardian(circle, '9999999999999999999999999999999999999999999999999999999999999999')).toBe(false)
    })
  })
})
