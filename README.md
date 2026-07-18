# @forgesworn/covey-kit

Private circle primitives for Nostr clients: deterministic circle and inbox
keys, local signers, role-aware circle state, personal-inbox payloads, direct
messages, private location shares, and speakable word-code invites.

Covey was extracted from Flock for reuse by Fledgling and other clients. It is
framework-free and owns no UI, storage, relay selection, or long-lived identity
material. Transport is delegated to
[`@forgesworn/roost-kit`](https://github.com/forgesworn/roost-kit).

## Install

```bash
npm install @forgesworn/covey-kit
```

ESM-only, Node 24 or newer. Until the package is published to npm, pin an
immutable Git commit rather than a branch.

## Main surfaces

- `deriveCircleSeed`, `deriveInbox`, `personalInboxTag` for deterministic,
  domain-separated routing identities.
- `createCircle`, `circleFromInvite`, `mergeConfig`, `guardians` and
  `isGuardian` for role-aware, latest-wins circle state.
- `sendToPersonalInbox`, invite/reseed helpers, direct-message helpers and
  one-recipient private location shares.
- `newWordCode`, `deriveWordCodeSeed`, `buildWordInviteRef` and
  `buildWordInviteDeletion` for the hardened spoken-invite rendezvous flow.
- `LocalSigner` for clients that deliberately hold an in-memory local key.

## Security boundary

Covey does not persist secrets or choose relays. The caller must protect circle
roots and signer material, enforce authorisation before applying membership
changes, publish all sensitive payloads through the encrypted Roost transport,
and treat human-readable invite codes as short-lived rendezvous credentials.

The word-code path parks only a disposable reference key, not the circle seed.
The actual invite remains NIP-59 encrypted to that one-time key and the parked
reference is deleted on successful fetch where the relay honours NIP-09.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

The library is MIT licensed.
