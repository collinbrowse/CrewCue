/**
 * Expo config plugin: Gradle often runs with a PATH that omits Homebrew, so
 * `commandLine("node", ...)` in settings.gradle fails with ENOENT on macOS.
 * Resolves NODE_BINARY, /opt/homebrew/bin/node, /usr/local/bin/node, or "node",
 * stores it on `gradle.ext`, and uses it in settings.gradle + app/build.gradle.
 *
 * Idempotent: skips files that already contain the marker comment.
 */
const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

const MARKER = "crewcueGradleNodeBootstrap";

const SETTINGS_INNER = `// ${MARKER}: PATH-safe Node for RN/Expo Gradle (see plugins/withAndroidGradleNodeExecutable.js)
def crewcueNode = {
  def fromEnv = System.getenv("NODE_BINARY")
  if (fromEnv != null && !fromEnv.trim().isEmpty()) {
    return fromEnv.trim()
  }
  if (new File("/opt/homebrew/bin/node").isFile()) {
    return "/opt/homebrew/bin/node"
  }
  if (new File("/usr/local/bin/node").isFile()) {
    return "/usr/local/bin/node"
  }
  return "node"
}()
gradle.ext.crewcueNodeExecutable = crewcueNode
`;

function patchSettingsGradle(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }
  const re = /pluginManagement {\n(\s*)def reactNativeGradlePlugin/;
  const m = contents.match(re);
  if (!m) {
    return contents;
  }
  const baseIndent = m[1];
  const bootstrap =
    SETTINGS_INNER.split("\n")
      .map((line) => (line.length ? baseIndent + line : ""))
      .join("\n") + "\n";
  return contents.replace(re, `pluginManagement {\n${bootstrap}${baseIndent}def reactNativeGradlePlugin`);
}

function patchSettingsCommandLine(contents) {
  return contents.replaceAll('commandLine("node",', "commandLine(crewcueNode,");
}

function patchAppBuildGradle(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }
  let next = contents;
  if (!next.includes("def crewcueNode = gradle.ext.crewcueNodeExecutable")) {
    next = next.replace(
      /(def projectRoot = rootDir\.getAbsoluteFile\(\)\.getParentFile\(\)\.getAbsolutePath\(\))\n/,
      `$1\n// ${MARKER}\ndef crewcueNode = gradle.ext.crewcueNodeExecutable\n`
    );
  }
  next = next.replaceAll('["node",', "[crewcueNode,");
  const bundlingComment = `    /* Bundling */
    //   A list containing the node command and its flags. Default is just 'node'.
    // nodeExecutableAndArgs = ["node"]`;
  if (next.includes(bundlingComment)) {
    next = next.replace(
      bundlingComment,
      `    /* Bundling */
    nodeExecutableAndArgs = [crewcueNode]`
    );
  } else if (!next.includes("nodeExecutableAndArgs = [crewcueNode]")) {
    // Template already customized; best-effort inject after react {
    next = next.replace(
      "react {\n    entryFile",
      "react {\n    nodeExecutableAndArgs = [crewcueNode]\n    entryFile"
    );
  }
  return next;
}

function withAndroidGradleNodeExecutable(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot;
      const settingsPath = path.join(platformRoot, "settings.gradle");
      const appGradlePath = path.join(platformRoot, "app", "build.gradle");
      try {
        if (fs.existsSync(settingsPath)) {
          let s = fs.readFileSync(settingsPath, "utf8");
          s = patchSettingsGradle(s);
          if (s.includes(MARKER)) {
            s = patchSettingsCommandLine(s);
          }
          fs.writeFileSync(settingsPath, s, "utf8");
        }
        if (fs.existsSync(appGradlePath)) {
          let a = fs.readFileSync(appGradlePath, "utf8");
          a = patchAppBuildGradle(a);
          fs.writeFileSync(appGradlePath, a, "utf8");
        }
      } catch (e) {
        console.warn(`withAndroidGradleNodeExecutable: ${e.message}`);
      }
      return cfg;
    },
  ]);
}

module.exports = withAndroidGradleNodeExecutable;
