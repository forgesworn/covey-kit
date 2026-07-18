// Hex <-> bytes. Ported from flock's `app/src/store.ts` (`fromHex`/`toHex`
// one-liners) as a standalone util. Duplicated from roost-kit's own copy of
// the same one-liner by design — kits stay independent, no cross-kit import
// for two lines of code.

import { bytesToHex } from '@noble/hashes/utils.js'

export const fromHex = (h: string): Uint8Array =>
  Uint8Array.from(h.match(/.{1,2}/g) ?? [], (x) => parseInt(x, 16))

export const toHex = (b: Uint8Array): string => bytesToHex(b)
