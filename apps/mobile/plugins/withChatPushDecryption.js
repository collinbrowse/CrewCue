/**
 * Expo config plugin: registers native components required for E2E push
 * decryption of crew chat messages.
 *
 * iOS: adds a Notification Service Extension target whose Swift code unwraps
 * the encrypted payload using a per-channel key cached in the App Group
 * keychain (see plugins/native/ios/NotificationService.swift).
 *
 * Android: registers a custom FirebaseMessagingService that decrypts the data
 * payload using a key cached in EncryptedSharedPreferences (see
 * plugins/native/android/ChatMessagingService.kt).
 *
 * The plugin is idempotent and safe to apply during `expo prebuild`. It does
 * NOT execute in pure managed (no-prebuild) mode, in which case push
 * notifications fall back to the generic body. Phase 6 of the chat rollout
 * (issue #230) wires the actual Xcode/Gradle modifications; this scaffold
 * keeps app.json valid in CI so phases 1-5 can ship without prebuild.
 */
const path = require("node:path");
const { withDangerousMod, withInfoPlist, withAndroidManifest } = require("@expo/config-plugins");

const APP_GROUP_ID = "group.com.crewcue.mobile.chat";
const NSE_TARGET_NAME = "ChatNotificationServiceExtension";

function withChatPushDecryptionIos(config) {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.NSUserActivityTypes = cfg.modResults.NSUserActivityTypes ?? [];
    cfg.modResults.UIBackgroundModes = Array.from(
      new Set([...(cfg.modResults.UIBackgroundModes ?? []), "remote-notification"])
    );
    return cfg;
  });

  config = withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, NSE_TARGET_NAME);
      cfg.modResults = cfg.modResults ?? {};
      cfg.modResults.chatPushDecryption = {
        appGroup: APP_GROUP_ID,
        nseTargetDir: targetDir,
        sourceBundle: path.join(cfg.modRequest.projectRoot, "plugins", "native", "ios"),
        scheduledForPhase6: true
      };
      return cfg;
    }
  ]);

  return config;
}

function withChatPushDecryptionAndroid(config) {
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

  return config;
}

module.exports = function withChatPushDecryption(config) {
  config = withChatPushDecryptionIos(config);
  config = withChatPushDecryptionAndroid(config);
  return config;
};

module.exports.APP_GROUP_ID = APP_GROUP_ID;
module.exports.NSE_TARGET_NAME = NSE_TARGET_NAME;
