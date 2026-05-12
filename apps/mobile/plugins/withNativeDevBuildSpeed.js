/**
 * Expo config plugin: faster local native iteration on slow machines.
 *
 * Android (reactNativeArchitectures):
 *   CrewCue targets Apple Silicon hosts + ARM Android emulators (`arm64-v8a`).
 *   `gradle.properties` is gitignored; this runs at `expo prebuild` and injects
 *   a single-ABI dev default. See README "Release and store builds" — you must
 *   restore full ABIs before shipping Play releases.
 *
 * iOS (ccache):
 *   Expo’s Podfile reads `apple.ccacheEnabled` in Podfile.properties.json.
 *   Install ccache once: `brew install ccache` (macOS).
 */
const {
  createRunOncePlugin,
  withGradleProperties,
  withPodfileProperties
} = require("@expo/config-plugins");

const PLUGIN_NAME = "withNativeDevBuildSpeed";

/** Default for Apple Silicon + ARM64 Android emulator images. */
const DEV_ONLY_ANDROID_ABI = "arm64-v8a";

function isEasBuildEnvironment() {
  const v = process.env.EAS_BUILD;
  return v === "true" || v === "1";
}

function gradleReleaseBannerComments() {
  return [
    {
      type: "comment",
      value:
        "========================================================================"
    },
    {
      type: "comment",
      value:
        "CREWCUE — LOCAL DEV ONLY (single Android ABI for faster Gradle builds)"
    },
    {
      type: "comment",
      value:
        "BEFORE ANY PLAY STORE / PRODUCTION RELEASE: restore reactNativeArchitectures"
    },
    {
      type: "comment",
      value:
        "to all ABIs you ship (typically armeabi-v7a,arm64-v8a,x86,x86_64) or remove"
    },
    {
      type: "comment",
      value:
        "this line and use the Expo/RN default. See apps/mobile/README.md and"
    },
    {
      type: "comment",
      value: "https://reactnative.dev/docs/build-speed"
    },
    {
      type: "comment",
      value:
        "========================================================================"
    },
    { type: "empty" }
  ];
}

function withAndroidSingleAbiForDev(config) {
  return withGradleProperties(config, (cfg) => {
    if (isEasBuildEnvironment()) {
      return cfg;
    }

    const list = cfg.modResults;
    if (!Array.isArray(list)) {
      return cfg;
    }

    const archIndex = list.findIndex(
      (entry) =>
        entry.type === "property" &&
        typeof entry.key === "string" &&
        entry.key.trim() === "reactNativeArchitectures"
    );

    const banner = gradleReleaseBannerComments();

    if (archIndex >= 0) {
      list.splice(archIndex, 0, ...banner);
      const updatedIndex = archIndex + banner.length;
      list[updatedIndex].value = DEV_ONLY_ANDROID_ABI;
    } else {
      list.unshift(
        ...banner,
        {
          type: "property",
          key: "reactNativeArchitectures",
          value: DEV_ONLY_ANDROID_ABI
        }
      );
    }

    return cfg;
  });
}

function withIosCcacheEnabled(config) {
  return withPodfileProperties(config, (cfg) => {
    cfg.modResults = {
      ...(cfg.modResults ?? {}),
      "apple.ccacheEnabled": "true"
    };
    return cfg;
  });
}

function withNativeDevBuildSpeedImpl(config) {
  config = withAndroidSingleAbiForDev(config);
  config = withIosCcacheEnabled(config);
  return config;
}

module.exports = createRunOncePlugin(withNativeDevBuildSpeedImpl, PLUGIN_NAME, "1.0.0");
