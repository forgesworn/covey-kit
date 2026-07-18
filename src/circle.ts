import { deriveCircleSeed } from './keys.js'

export type Role = 'guardian' | 'child' | 'peer'

export interface CircleMember {
  pk: string
  role: Role
  name?: string
}

export interface Circle {
  id: string
  name: string
  seedHex: string
  epoch: number
  members: CircleMember[]
  createdAt: number
  reseededAt?: number
  expiresAt?: number
  configUpdatedAt: number
  configBy: string
}

export interface CircleConfig {
  v: 1
  id: string
  name: string
  members: CircleMember[]
  updatedAt: number
  by: string
}

/**
 * Create a new circle with a derived seed from the root and circle ID.
 * The creator becomes the first member.
 * seedHex = deriveCircleSeed(rootHex, id, 0), epoch 0, members [creator]
 */
export function createCircle(opts: {
  id: string
  name: string
  rootHex: string
  creator: CircleMember
  nowSec: number
}): Circle {
  const seedHex = deriveCircleSeed(opts.rootHex, opts.id, 0)
  return {
    id: opts.id,
    name: opts.name,
    seedHex,
    epoch: 0,
    members: [opts.creator],
    createdAt: opts.nowSec,
    configUpdatedAt: opts.nowSec,
    configBy: opts.creator.pk,
  }
}

/**
 * Join a circle from an invite (no creator context).
 * seedHex = p.s, name = p.n, members [self] (full roster arrives via config sync)
 */
export function circleFromInvite(
  p: { id: string; s: string; n: string },
  self: CircleMember,
  nowSec: number,
): Circle {
  return {
    id: p.id,
    name: p.n,
    seedHex: p.s,
    epoch: 0,
    members: [self],
    createdAt: nowSec,
    configUpdatedAt: nowSec,
    configBy: self.pk,
  }
}

/**
 * Apply a reseed: increment epoch, update seedHex, set reseededAt.
 */
export function applyReseed(c: Circle, p: { id: string; s: string }, nowSec: number): Circle {
  return {
    ...c,
    seedHex: p.s,
    epoch: c.epoch + 1,
    reseededAt: nowSec,
  }
}

/**
 * Add or update a member. If the member's pk exists, replace it; otherwise append.
 */
export function upsertMember(c: Circle, m: CircleMember, by: string, nowSec: number): Circle {
  const existingIndex = c.members.findIndex((member) => member.pk === m.pk)
  let newMembers: CircleMember[]

  if (existingIndex >= 0) {
    newMembers = [...c.members]
    newMembers[existingIndex] = m
  } else {
    newMembers = [...c.members, m]
  }

  return {
    ...c,
    members: newMembers,
    configUpdatedAt: nowSec,
    configBy: by,
  }
}

/**
 * Remove a member by pk.
 */
export function removeMember(c: Circle, pk: string, by: string, nowSec: number): Circle {
  if (!c.members.some((member) => member.pk === pk)) return c
  return {
    ...c,
    members: c.members.filter((m) => m.pk !== pk),
    configUpdatedAt: nowSec,
    configBy: by,
  }
}

/**
 * Build a CircleConfig representation of the current state.
 */
export function buildConfig(c: Circle): CircleConfig {
  return {
    v: 1,
    id: c.id,
    name: c.name,
    members: c.members,
    updatedAt: c.configUpdatedAt,
    by: c.configBy,
  }
}

/**
 * Validate that a value is a valid Role.
 */
function isValidRole(role: unknown): role is Role {
  return role === 'guardian' || role === 'child' || role === 'peer'
}

/**
 * Validate that a string is a 64-character hex string (pubkey).
 */
function is64Hex(str: unknown): boolean {
  if (typeof str !== 'string') return false
  return /^[0-9a-f]{64}$/i.test(str)
}

/**
 * Validate a CircleConfig shape.
 */
function validateConfig(obj: unknown): obj is CircleConfig {
  if (!obj || typeof obj !== 'object') return false
  const cfg = obj as Record<string, unknown>

  if (cfg.v !== 1) return false
  if (typeof cfg.id !== 'string') return false
  if (typeof cfg.name !== 'string') return false
  if (!Array.isArray(cfg.members)) return false
  if (typeof cfg.updatedAt !== 'number' || !isFinite(cfg.updatedAt)) return false
  if (typeof cfg.by !== 'string') return false

  // Validate each member
  for (const member of cfg.members as unknown[]) {
    if (!member || typeof member !== 'object') return false
    const m = member as Record<string, unknown>
    if (!is64Hex(m.pk)) return false
    if (!isValidRole(m.role)) return false
    if (m.name !== undefined && typeof m.name !== 'string') return false
  }

  return true
}

/**
 * Merge incoming config with the current circle state.
 * Latest-wins: incoming.updatedAt > c.configUpdatedAt means accept.
 * Tie-break: if updatedAt equal, lexicographically SMALLER `by` wins.
 * Invalid/malformed → return c unchanged.
 * ID mismatch → return c unchanged.
 * Bad role or pubkey → return c unchanged.
 */
export function mergeConfig(c: Circle, incoming: unknown): Circle {
  // Try to parse if it's a string
  let config: CircleConfig
  if (typeof incoming === 'string') {
    try {
      config = JSON.parse(incoming)
    } catch {
      return c
    }
  } else {
    config = incoming as CircleConfig
  }

  // Validate shape and structure
  if (!validateConfig(config)) {
    return c
  }

  // Check ID match
  if (config.id !== c.id) {
    return c
  }

  // Determine if we should apply this config
  const shouldApply =
    config.updatedAt > c.configUpdatedAt ||
    (config.updatedAt === c.configUpdatedAt && config.by < c.configBy)

  if (!shouldApply) {
    return c
  }

  return {
    ...c,
    name: config.name,
    members: config.members,
    configUpdatedAt: config.updatedAt,
    configBy: config.by,
  }
}

/**
 * Get all guardian members.
 */
export function guardians(c: Circle): CircleMember[] {
  return c.members.filter((m) => m.role === 'guardian')
}

/**
 * Check if a pubkey belongs to a guardian member.
 */
export function isGuardian(c: Circle, pk: string): boolean {
  return c.members.some((m) => m.pk === pk && m.role === 'guardian')
}
