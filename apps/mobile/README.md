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

## Native build speed (local dev)

The Expo config plugin **`withNativeDevBuildSpeed.js`** runs during **`expo prebuild`**:

- **Android:** sets `reactNativeArchitectures` to **`arm64-v8a`** for faster local Gradle builds (matches **Apple Silicon Macs** + **ARM64 Android emulator** system images). A large comment block is injected into **`android/gradle.properties`** above that property so it is hard to miss.
- **iOS:** sets **`apple.ccacheEnabled`** in **`ios/Podfile.properties.json`**. Install **`ccache`** once on macOS: `brew install ccache`.

**EAS Build:** when `EAS_BUILD` is set (cloud or `eas build --local`), the plugin **does not** pin a single Android ABI, so store/EAS artifacts keep the default multi-ABI configuration.

### Release and store builds (Android)

If you run **`expo prebuild`** on your machine and then ship a **Play Store** or **production** Android binary **outside EAS**, you must **not** leave a single ABI in `gradle.properties`. Restore the default list (typically `armeabi-v7a,arm64-v8a,x86,x86_64`) or match what your release process requires. See [Speeding up your Build phase (React Native)](https://reactnative.dev/docs/build-speed).

**Intel Mac + x86 Android emulator:** change the pinned value to **`x86_64`** in `plugins/withNativeDevBuildSpeed.js` (`DEV_ONLY_ANDROID_ABI`) or override from the CLI when running Gradle: `./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64`.
