# CrewCue mobile (`@crewcue/mobile`)

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
