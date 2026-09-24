# AGENTS.md: covey-kit

Instructions in this file apply to the entire repository.

## Project Summary
- Private circle primitives for Nostr clients: derived keys, role-aware circle state, personal inboxes, and word-code invites, extracted from Flock for reuse by other ForgeSworn clients.
- Framework-free: owns no UI, storage, relay selection, or long-lived identity material. Transport (gift-wrapping, relay I/O) is delegated to `@forgesworn/roost-kit`.
- ESM-only package (`"type": "module"`).
- Requires Node.js 24+.

## Key Commands
- `npm run build`: compile TypeScript into `dist/`
- `npm test`: run the Vitest suite (includes `compatibility/v1/compatibility.test.ts`)
- `npm run test:watch`: run tests in watch mode
- `npm run typecheck`: TypeScript type-check without emitting

## Repository Structure
- `src/hex.ts`: hex to bytes conversion (intentionally duplicated from roost-kit's own copy; kits stay independent)
- `src/keys.ts`: deterministic circle-seed and inbox-key derivation (via `nsec-tree`)
- `src/circle.ts`: circle state: creation, membership, roles, latest-wins config merge
- `src/signer-local.ts`: `LocalSigner`, the in-memory local-key backend for roost-kit's `Signer` interface
- `src/inbox.ts`: personal-inbox gift-wrapped payloads: invites/reseeds, direct messages, private location shares
- `src/wordcode.ts`: six-word spoken invite codes (scrypt-stretched, parked-reference rendezvous)
- `src/index.ts`: barrel re-export (the package's only entry point)
- `compatibility/v1/`: frozen compatibility vectors (derivation, circle-state clock, word-code and personal-inbox semantics); a consumer contract, change only for a deliberate, versioned change
- `dist/`: build output (generated)

## Exports
- `@forgesworn/covey-kit`: single entry point, no subpath exports.
- Derived keys: `fromHex`, `toHex`, `deriveCircleSeed`, `deriveInbox`, `personalInboxTag`, `LocalSigner`, `makeLocalSigner`.
- Circle state: `createCircle`, `circleFromInvite`, `applyReseed`, `upsertMember`, `removeMember`, `buildConfig`, `mergeConfig` (+ types `Role`, `CircleMember`, `Circle`, `CircleConfig`).
- Roles: `guardians`, `isGuardian`.
- Invites & word codes: `buildInviteWrap`, `buildReseedWraps`, `readInvite`, `readInviteViaRef`, `WORD_INVITE`, `newWordCode`, `wordCodeFromEntropy`, `suggestWords`, `normaliseWordCode`, `deriveWordCodeSeed`, `wordInviteTag`, `buildWordInviteRef`, `readWordInviteRef`, `wordInviteParkKey`, `buildWordInviteDeletion` (+ type `WordInviteRef`).
- Personal inboxes: `sendToPersonalInbox`, `readFromPersonalInbox`, `buildDmWrap`, `readDmWrap`, `buildPrivateLocationWrap`, `readPrivateLocationWrap` (+ types `InvitePayload`, `DirectMessage`, `PrivateLocationShare`).

## Coding Conventions
- Use British English spelling in identifiers and prose: `licence`, `colour`, `behaviour`, `authorisation`.
- Keep `src/` framework-free and silent: no DOM access, storage access, environment reads, console output, or baked-in relay defaults (per `CONTRIBUTING.md`).
- Preserve byte compatibility with Flock for extracted key and invite flows; the `compatibility/v1` fixtures freeze this contract for consumers.
- Uses NIP-44 encryption (via `nostr-tools/nip44`) and NIP-59 gift-wrapping (via `@forgesworn/roost-kit`), never the deprecated NIP-04. Word-code deletion uses NIP-09; the parked reference event uses the NIP-40 `expiration` tag.
- Prefer TDD when changing behaviour: add or update a failing test first, then implement.
- Keep changes minimal and consistent with the existing module layout.
- Maintain ESM-compatible imports/exports: relative imports use explicit `.js` extensions, per `NodeNext` module resolution.
- Commit messages use `type: description` format; do not include `Co-Authored-By` lines.

## Working Guidelines
- Do not edit generated output in `dist/` by hand.
- Run `npm run typecheck`, `npm test`, and `npm run build` before considering a change complete (mirrors the `verify` job in `.github/workflows/ci.yml`).
- Changes under `compatibility/v1/` are a versioned consumer-contract change, not routine test maintenance: update the fixtures deliberately.
- Update `README.md` / `CHANGELOG.md` when the public API or behaviour changes.
- `@forgesworn/covey-kit` depends on the private `@forgesworn/roost-kit` over a pinned Git commit; CI needs a `FORGESWORN_READ_PAT` repo secret to fetch it (see the comment in `ci.yml`).

## Release & Versioning

Manual: there is no anvil-based or other automated publish workflow wired up yet (`.github/workflows/` has only `ci.yml`: typecheck, test, build, `npm pack --dry-run`).

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

Tests, typecheck, and build should all pass before release-related changes are considered complete.
