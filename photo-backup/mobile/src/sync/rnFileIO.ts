import RNFS from 'react-native-fs';
import { base64ToBytes, bytesToBase64 } from '../crypto/bytes';
import type { FileIO } from '../crypto/fileCipher';

/** react-native-fs backed FileIO: reads/writes one chunk at a time via base64 over the bridge. */
export const rnFileIO: FileIO = {
  async size(path) { return (await RNFS.stat(path)).size; },
  async read(path, offset, length) {
    if (length === 0) return new Uint8Array(0);
    return base64ToBytes(await RNFS.read(path, length, offset, 'base64'));
  },
  async write(path, data, offset) {
    const b64 = bytesToBase64(data);
    if (offset === 0) await RNFS.writeFile(path, b64, 'base64');
    else await RNFS.appendFile(path, b64, 'base64');
  },
};
