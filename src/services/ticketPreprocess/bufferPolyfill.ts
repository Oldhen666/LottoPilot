/**
 * Must run before any `jpeg-js` import: encoder uses `Buffer.from` when Metro defines `module`.
 * Hermes has no Node Buffer — set on both globals used by RN.
 */
import { Buffer } from 'buffer';

const B = Buffer;
(globalThis as unknown as { Buffer: typeof B }).Buffer = B;
if (typeof global !== 'undefined') {
  (global as unknown as { Buffer: typeof B }).Buffer = B;
}
