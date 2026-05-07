/**
 * Expo config plugin: wires the native components required for E2E push
 * decryption of crew chat messages.
 *
 * iOS (Phase 6 — issue #230):
 *   - adds App Group entitlement `group.com.crewcue.mobile.chat` so the main
 *     app and the Notification Service Extension share a keychain.
 *   - copies NSE source files into `apps/mobile/ios/ChatNotificationServiceExtension`.
 *     (Xcode target creation is a one-time manual step; the plugin now warns
 *     when the target is missing from `project.pbxproj`.)
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
  withAndroidManifest,
  withAppBuildGradle
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
      const pbxprojPath = path.join(platformRoot, "CrewCue.xcodeproj", "project.pbxproj");
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
          if (fs.existsSync(pbxprojPath)) {
            const pbxproj = fs.readFileSync(pbxprojPath, "utf8");
            if (!pbxproj.includes(NSE_TARGET_NAME)) {
              // eslint-disable-next-line no-console
              console.warn(
                `withChatPushDecryption(iOS): '${NSE_TARGET_NAME}' target is not in Xcode project yet. ` +
                  "Create it once in Xcode (Notification Service Extension), then rerun prebuild."
              );
            }
          }
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
  const androidPackage = config?.android?.package || "com.crewcue.mobile";
  const packagePath = androidPackage.split(".").join(path.sep);
  const fullServiceClassName = `${androidPackage}.ChatMessagingService`;
  const shortServiceClassName = ".ChatMessagingService";

  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest?.application?.[0];
    if (!application) {
      return cfg;
    }
    application.service = application.service ?? [];
    const exists = application.service.some(
      (svc) => {
        const serviceName = svc?.$?.["android:name"];
        return serviceName === shortServiceClassName || serviceName === fullServiceClassName;
      }
    );
    if (!exists) {
      application.service.push({
        $: {
          "android:name": fullServiceClassName,
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
        packagePath
      );
      try {
        if (fs.existsSync(sourceFile)) {
          fs.mkdirSync(targetDir, { recursive: true });
          const dest = path.join(targetDir, "ChatMessagingService.kt");
          fs.copyFileSync(sourceFile, dest);
          // Ensure we never compile duplicate class declarations from both
          // src/main/java and src/main/kotlin.
          const duplicateKotlin = path.join(
            platformRoot,
            "app",
            "src",
            "main",
            "kotlin",
            packagePath,
            "ChatMessagingService.kt"
          );
          if (fs.existsSync(duplicateKotlin)) {
            fs.unlinkSync(duplicateKotlin);
          }
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

function withAndroidFcmDependencies(config) {
  return withAppBuildGradle(config, (cfg) => {
    const anchor = 'implementation("com.facebook.react:react-android")';
    const deps = [
      '    implementation("com.google.firebase:firebase-messaging:24.1.0")',
      '    implementation("com.goterl:lazysodium-android:5.1.0@aar")',
      '    implementation("net.java.dev.jna:jna:5.13.0@aar")',
      '    implementation("androidx.security:security-crypto:1.1.0-alpha06")'
    ];
    let content = cfg.modResults.contents;
    if (content.includes(deps[0])) {
      return cfg;
    }
    if (content.includes(anchor)) {
      content = content.replace(anchor, `${anchor}\n${deps.join("\n")}`);
      cfg.modResults.contents = content;
    } else {
      // eslint-disable-next-line no-console
      console.warn("withChatPushDecryption(Android deps): could not find react-android dependency anchor.");
    }
    return cfg;
  });
}

module.exports = function withChatPushDecryption(config) {
  config = withIosEntitlements(config);
  config = withIosBackgroundModes(config);
  config = withIosNseSource(config);
  config = withAndroidFcmService(config);
  config = withAndroidFcmDependencies(config);
  return config;
};

module.exports.APP_GROUP_ID = APP_GROUP_ID;
module.exports.NSE_TARGET_NAME = NSE_TARGET_NAME;
