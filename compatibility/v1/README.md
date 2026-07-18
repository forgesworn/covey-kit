# Covey compatibility vectors v1

These fixtures freeze the stable circle contract shared by ForgeSworn apps:
circle and inbox derivation, personal-inbox routing, six-word rendezvous codes,
circle-state clocks, and invite/reseed payload semantics.

The NIP-59 outer wrap is intentionally randomised by Roost, so the suite checks
its stable routing and recovered payload rather than treating ciphertext as a
golden byte string. Change the fixtures only for a deliberate, versioned
contract change.
