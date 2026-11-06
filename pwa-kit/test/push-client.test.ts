import test from 'node:test'; import assert from 'node:assert/strict';
import { urlBase64ToUint8Array } from '../lib/push-client';
test('decodes url-safe base64 without padding', () => {
  const out = urlBase64ToUint8Array('AQID-_8'); // bytes 1,2,3,0xfb,0xff
  assert.deepEqual(Array.from(out), [1, 2, 3, 251, 255]);
});
test('a 65-byte VAPID public key decodes to 65 bytes', () => {
  const k = Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => i)).toString('base64url');
  assert.equal(urlBase64ToUint8Array(k).length, 65);
});
