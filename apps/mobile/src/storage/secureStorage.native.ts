/**
 * iOS / Android: real SecureStore (not used in web bundles).
 */
import type { SecureStoreOptions } from "expo-secure-store";
import * as SecureStore from "expo-secure-store";

export async function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export async function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void> {
  await SecureStore.setItemAsync(key, value, options);
}

export async function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void> {
  await SecureStore.deleteItemAsync(key, options);
}
