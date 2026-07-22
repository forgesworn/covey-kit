# CLAUDE.md — covey-kit

Private circle primitives for Nostr clients: derived keys, roles, invites, personal inboxes, word codes, and convergent circle state.

## Commands

- `npm run build` — compile TypeScript to dist/
- `npm test` — run all tests (vitest), including `compatibility/v1/compatibility.test.ts`
- `npm run test:watch` — watch mode
- `npm run typecheck` — type-check without emitting

## Structure

- `src/hex.ts` — hex ⇄ bytes conversion
- `src/keys.ts` — deterministic circle-seed and inbox-key derivation
- `src/circle.ts` — circle state, roles, latest-wins config merge
- `src/signer-local.ts` — `LocalSigner`, the in-memory local-key `Signer` backend
- `src/inbox.ts` — personal-inbox gift-wrapped payloads (invites/reseeds, DMs, location shares)
- `src/wordcode.ts` — six-word spoken invite codes
- `src/index.ts` — barrel re-export
- `compatibility/v1/` — frozen compatibility vectors (consumer contract)

## Exports

- `@forgesworn/covey-kit` — single entry point, no subpath exports
- Derived keys: `fromHex`, `toHex`, `deriveCircleSeed`, `deriveInbox`, `personalInboxTag`, `LocalSigner`, `makeLocalSigner`
- Circle state: `createCircle`, `circleFromInvite`, `applyReseed`, `upsertMember`, `removeMember`, `buildConfig`, `mergeConfig` (+ types `Role`, `CircleMember`, `Circle`, `CircleConfig`)
- Roles: `guardians`, `isGuardian`
- Invites & word codes: `buildInviteWrap`, `buildReseedWraps`, `readInvite`, `readInviteViaRef`, `WORD_INVITE`, `newWordCode`, `wordCodeFromEntropy`, `suggestWords`, `normaliseWordCode`, `deriveWordCodeSeed`, `wordInviteTag`, `buildWordInviteRef`, `readWordInviteRef`, `wordInviteParkKey`, `buildWordInviteDeletion` (+ type `WordInviteRef`)
- Personal inboxes: `sendToPersonalInbox`, `readFromPersonalInbox`, `buildDmWrap`, `readDmWrap`, `buildPrivateLocationWrap`, `readPrivateLocationWrap` (+ types `InvitePayload`, `DirectMessage`, `PrivateLocationShare`)

## Conventions

- **British English** — licence, colour, behaviour, authorisation
- **ESM-only** — `"type": "module"` in package.json, Node 24+
- **Framework-free** — no DOM/storage/env reads/console output/baked-in relay defaults in `src/` (the caller owns all of that)
- **NIP-44** encryption, **NIP-59** gift-wrapping (never NIP-04) — via `nostr-tools` and `@forgesworn/roost-kit`
- **TDD** — write failing test first, then implement
- **Git:** commit messages use `type: description` format
- **Git:** Do NOT include `Co-Authored-By` lines in commits

## Release & Versioning

Manual — there is no anvil-based or other automated publish workflow wired up yet (`.github/workflows/` has only `ci.yml`: typecheck, test, build, `npm pack --dry-run`).

Release flow:

1. Bump `package.json` version by hand
2. Add a `CHANGELOG.md` entry under the new version heading (Keep a Changelog format)
3. Commit (`chore: release x.y.z`), push main
4. Tag the commit and create a GitHub Release if/when publishing to npm is set up

Semver rules of thumb (package is pre-1.0, currently `0.1.0`):

| Change | Bump |
|---|---|
| Bug fix, no API change | Patch (0.1.x) |
| New feature, backwards compatible | Minor (0.x.0) |
| Breaking API change | Minor (0.x.0) pre-1.0; Major once the package reaches 1.0.0 |
| Tooling, docs, refactor with no behaviour change | Patch or none |
