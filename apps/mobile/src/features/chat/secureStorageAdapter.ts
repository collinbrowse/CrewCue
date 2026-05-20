import type { ChatCryptoStorageAdapter } from "@crewcue/chat-crypto";
import { deleteItemAsync, getItemAsync, setItemAsync } from "../../storage/secureStorage";

export const chatSecureStorageAdapter: ChatCryptoStorageAdapter = {
  getItem: (key) => getItemAsync(key),
  setItem: (key, value) => setItemAsync(key, value),
  deleteItem: (key) => deleteItemAsync(key)
};
