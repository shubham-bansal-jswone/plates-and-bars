import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// No imports from the other secure/ files: tokens.ts, the vault and keystore.ts all use this one.
export const PHOTO_KEY = 'pb.photo_key';

/**
 * Options for the keystore writes that hold the tokens and the photo key. On iOS the item is readable only while the
 * phone is unlocked and never leaves this device, so a restored backup on another phone cannot decrypt the photos or
 * reuse the session. Android has no such option: nothing is passed there and behaviour is unchanged.
 */
export const secureOptions = (): SecureStore.SecureStoreOptions =>
  Platform.OS === 'ios' ? { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } : {};
