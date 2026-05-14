# CrewCue mobile (`@crewcue/mobile`)

## `Unable to resolve "../../App" from "node_modules/expo/AppEntry.js"`

Expo resolves the JS entry from **`process.cwd()`** when you run CLI commands. If you run **`npx expo start`** or **`npx expo run:ios` from the monorepo root** (no `main` there), `@expo/config` falls through to **`expo/AppEntry.js`**, which imports **`../../App`** next to the **root** `package.json` — not **`apps/mobile/App`**.

**Fix:** The root **`package.json`** sets **`"main": "./apps/mobile/index.ts"`** so entry resolution works from the repo root as well. Prefer **`npm run dev:mobile`** / **`npm run ios -w @crewcue/mobile`** so the working directory is **`apps/mobile`**.

## iOS: `pod install` / `React-Core-prebuilt` “Missing required attribute `source`”

React Native **0.83+** (Expo SDK 55) downloads **React-Core-prebuilt** using paths derived from your project directory. If the **full path to the repo contains spaces**, that step can fail and CocoaPods surfaces a **misleading** validation error:

`The React-Core-prebuilt pod failed to validate … Missing required attribute source`

This matches upstream reports (e.g. [expo#42647](https://github.com/expo/expo/issues/42647)) where the underlying failure was **spaces in the folder path**.

### Fix

1. Move or re-clone the monorepo to a path **with no spaces**, for example:
   - `~/Developer/CrewCue`
   - `/Users/<you>/Documents/CrewCue`
2. From the repo root: `npm install`
3. From `apps/mobile`: clean native projects and regenerate, then build:
   - `rm -rf ios android`
   - `npx expo prebuild`
   - `npx expo run:ios`

MapLibre and other native modules require a **development build** (not Expo Go); use `expo-dev-client` after a successful native compile.

## Android emulator: dev client shows `Connection reset` / cannot load Metro

The monorepo uses **`npm run android -w @crewcue/mobile`** (wrapper `scripts/mobile-expo-start.mjs`) so Metro resolves workspace packages via `metro.config.js`, runs **`adb reverse tcp:8081 tcp:8081`**, and (when ADB reports a QEMU emulator) sets **`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2`** so the dev client does not rely on LAN routing to the host.

If you run **`npx expo run:android` without the wrapper**, you skip that logic. Physical device on Wi‑Fi may need **`REACT_NATIVE_PACKAGER_HOSTNAME`** set to your computer’s LAN address.

## Android: `IllegalViewOperationException` / missing `RNCSafeAreaProvider`

Usually means the **native dev client is out of date** vs your JS dependencies, or **New Architecture** flags disagreed between Expo config and `android/gradle.properties`.

1. From the repo root: **`npx expo prebuild --clean --platform android`** (or delete `apps/mobile/android` and run **`npx expo prebuild --platform android`**).
2. Uninstall the old app from the device/emulator.
3. **`npm run android -w @crewcue/mobile`** (or your EAS development profile) so the APK is rebuilt with current autolinking (`react-native-safe-area-context` ships `RNCSafeAreaProvider` on Fabric).

The app keeps **`newArchEnabled: true`** in Expo config so Metro and Gradle stay aligned with React Native 0.83 / Expo SDK 55.

## Android 15+: “16 KB compatible” / ELF alignment popup

Some devices show **Android App Compatibility** because a bundled `.so` was built for 4KB page alignment. The OS still runs the app in **compatibility mode**; tap **OK** (or **Don’t show again**) to dismiss.

- **CrewCue-specific:** Chat push decryption uses **`lazysodium-android` 5.2.0+**, which ships **16KB-aligned `libsodium.so`**. If you still see **`libsodium.so` / LOAD segment not aligned**, run **`npx expo prebuild --clean --platform android`** (or bump the dependency in `app/build.gradle` to **5.2.0**) and reinstall the dev client.
- **Other listed libraries** (`libreactnative.so`, `libexpo-modules-core.so`, etc.) come from **Expo / React Native**; clear the warning by staying on current **Expo SDK 55** patch releases and rebuilding after upgrades. See [Expo FYI: 16KB page sizes](https://github.com/expo/fyi/blob/main/android-16kb-page-sizes.md) and [Android docs](https://developer.android.com/guide/practices/page-sizes).
