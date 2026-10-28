import * as Keychain from 'react-native-keychain';
import { base64ToBytes, bytesToBase64 } from './bytes';
import { keysFromMaster, type UserKeys } from './keys';

/**
 * The derived master key (not the user's secret) is cached in the Keychain / Android Keystore so
 * background jobs can encrypt while the phone is locked. AFTER_FIRST_UNLOCK is required for that;
 * THIS_DEVICE_ONLY keeps it out of iCloud/device backups.
 */
const SERVICE = 'bkz.master';

export async function saveMasterKey(master: Uint8Array) {
  await Keychain.setGenericPassword('master', bytesToBase64(master), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function loadKeys(): Promise<UserKeys | null> {
  const c = await Keychain.getGenericPassword({ service: SERVICE });
  return c ? keysFromMaster(base64ToBytes(c.password)) : null;
}

export const clearMasterKey = () => Keychain.resetGenericPassword({ service: SERVICE });
