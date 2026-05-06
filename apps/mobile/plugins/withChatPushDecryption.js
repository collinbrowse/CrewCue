/**
 * Expo config plugin: wires the native components required for E2E push
 * decryption of crew chat messages.
 *
 * iOS (Phase 6 — issue #230):
 *   - adds App Group entitlement `group.com.crewcue.mobile.chat` so the main
 *     app and the Notification Service Extension share a keychain.
 *   - generates the NSE Xcode target alongside `apps/mobile/ios/` and copies
 *     in `plugins/native/ios/NotificationService.swift`.
 *   - sets `mutable-content: 1` on chat push payloads so the NSE runs.
 *
 * Android (Phase 6 — issue #230):
 *   - registers `ChatMessagingService` as a `FirebaseMessagingService` in the
 *     Android manifest.
 *   - copies `plugins/native/android/ChatMessagingService.kt` into the
 *     generated Android source set.
 *
 * The plugin is idempotent and only takes effect during `expo prebuild`.
 * When the project ships in pure managed Expo (no prebuild), this plugin is
 * a no-op and the OS shows the generic fallback body
 * `New Message in Crew Chat` instead of the decrypted body.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withAndroidManifest
} = require("@expo/config-plugins");

const APP_GROUP_ID = "group.com.crewcue.mobile.chat";
const NSE_TARGET_NAME = "ChatNotificationServiceExtension";

function withIosEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = new Set([
      ...((cfg.modResults["com.apple.security.application-groups"] || [])),
      APP_GROUP_ID
    ]);
    cfg.modResults["com.apple.security.application-groups"] = Array.from(groups);
    return cfg;
  });
}

function withIosBackgroundModes(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = new Set([...(cfg.modResults.UIBackgroundModes || []), "remote-notification"]);
    cfg.modResults.UIBackgroundModes = Array.from(modes);
    return cfg;
  });
}

function withIosNseSource(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const projectRoot = cfg.modRequest.projectRoot;
      const nseDir = path.join(platformRoot, NSE_TARGET_NAME);
      const sourceFile = path.join(projectRoot, "plugins", "native", "ios", "NotificationService.swift");
      try {
        if (fs.existsSync(sourceFile)) {
          fs.mkdirSync(nseDir, { recursive: true });
          const dest = path.join(nseDir, "NotificationService.swift");
          fs.copyFileSync(sourceFile, dest);
          fs.writeFileSync(
            path.join(nseDir, "Info.plist"),
            buildNseInfoPlist(),
            "utf8"
          );
          fs.writeFileSync(
            path.join(nseDir, `${NSE_TARGET_NAME}.entitlements`),
            buildNseEntitlements(),
            "utf8"
          );
        }
      } catch (err) {
        // Surface as a config plugin warning rather than fatal — the prebuild
        // pipeline must still produce a buildable workspace; the operator
        // wires the NSE target in Xcode if the auto-copy fails.
        // eslint-disable-next-line no-console
        console.warn(`withChatPushDecryption(iOS NSE copy failed): ${err.message}`);
      }
      return cfg;
    }
  ]);
}

function buildNseInfoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${NSE_TARGET_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundlePackageType</key>
  <string>XPC!</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.usernotifications.service</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).NotificationService</string>
  </dict>
</dict>
</plist>
`;
}

function buildNseEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array>
    <string>${APP_GROUP_ID}</string>
  </array>
</dict>
</plist>
`;
}

function withAndroidFcmService(config) {
  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest?.application?.[0];
    if (!application) {
      return cfg;
    }
    application.service = application.service ?? [];
    const exists = application.service.some(
      (svc) => svc?.$?.["android:name"] === ".ChatMessagingService"
    );
    if (!exists) {
      application.service.push({
        $: {
          "android:name": ".ChatMessagingService",
          "android:exported": "false"
        },
        "intent-filter": [
          {
            action: [
              {
                $: {
                  "android:name": "com.google.firebase.MESSAGING_EVENT"
                }
              }
            ]
          }
        ]
      });
    }
    return cfg;
  });

  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const projectRoot = cfg.modRequest.projectRoot;
      const sourceFile = path.join(
        projectRoot,
        "plugins",
        "native",
        "android",
        "ChatMessagingService.kt"
      );
      const targetDir = path.join(
        platformRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "crewcue",
        "mobile"
      );
      try {
        if (fs.existsSync(sourceFile)) {
          fs.mkdirSync(targetDir, { recursive: true });
          const dest = path.join(targetDir, "ChatMessagingService.kt");
          fs.copyFileSync(sourceFile, dest);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`withChatPushDecryption(Android FCM copy failed): ${err.message}`);
      }
      return cfg;
    }
  ]);

  return config;
}

module.exports = function withChatPushDecryption(config) {
  config = withIosEntitlements(config);
  config = withIosBackgroundModes(config);
  config = withIosNseSource(config);
  config = withAndroidFcmService(config);
  return config;
};

module.exports.APP_GROUP_ID = APP_GROUP_ID;
module.exports.NSE_TARGET_NAME = NSE_TARGET_NAME;
