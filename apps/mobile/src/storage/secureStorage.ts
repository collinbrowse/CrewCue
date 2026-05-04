/**
 * TypeScript entry: implementations live in `secureStorage.web.ts` and `secureStorage.native.ts`.
 * Metro resolves `.web` / `.native` before this file when bundling, so web builds never load `expo-secure-store`.
 */
export { getItemAsync, setItemAsync, deleteItemAsync } from "./secureStorage.native";
