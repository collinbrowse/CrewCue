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

## `Cannot find native module 'ExpoWebBrowser'`

Auth0 uses **`expo-auth-session`**, which depends on **`expo-web-browser`** native code. Metro is loading JS that expects that module inside the **app binary** you opened.

### Typical causes

- An **older CrewCue dev client** on the device or simulator, built before `expo-web-browser` was in the project or before `app.json` listed the plugin.
- Opening the bundle with **Expo Go** from the store while your workflow assumes a **custom dev client** (this repo uses `expo-dev-client` and several config plugins).

### Fix

1. From the repo root: `npm install`
2. From **`apps/mobile`**, install a **new** native build on the device or simulator you use for testing:
   - `npx expo run:ios`, or `npm run ios -w @crewcue/mobile` (same thing via the workspace script), **or**
   - `eas build --profile development --platform ios` and install the artifact.
3. Start Metro (`npm run dev:mobile`), then open **that** CrewCue build (not an unrelated Expo Go session).

After any change to `app.json` **plugins** or native dependencies, assume you need a **rebuild**, not only a JS reload.
