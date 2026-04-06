/** Hermes has no Node `Buffer`; jpeg-js encode path uses `Buffer.from` under Metro. */
import { Buffer } from 'buffer';
const B = Buffer;
(globalThis as unknown as { Buffer: typeof B }).Buffer = B;
if (typeof global !== 'undefined') {
  (global as unknown as { Buffer: typeof B }).Buffer = B;
}

/** SQLite-backed localStorage for native - survives OTA updates better than AsyncStorage */
import 'expo-sqlite/localStorage/install';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
