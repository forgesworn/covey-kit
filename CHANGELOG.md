# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-18

Initial release of `@forgesworn/covey-kit` — private circle primitives for
Nostr clients, extracted from Flock for reuse by Fledgling and other
clients. Transport is delegated to `@forgesworn/roost-kit`.

### Added

- Circle keys, `LocalSigner`, personal-inbox payloads, and speakable
  word-code invites (extracted from Flock).
- A circle state model with roles and latest-wins config merge.

### Fixed

- Closed compatibility gaps against the frozen Covey compatibility
  contract.

[0.1.0]: https://github.com/forgesworn/covey-kit/releases/tag/v0.1.0
