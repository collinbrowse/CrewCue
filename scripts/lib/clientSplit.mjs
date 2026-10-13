/**
 * @param {string[]} files
 */
export function classifyNativeClientDiff(files) {
  const paths = files.map((file) => file.replaceAll("\\", "/"));
  const ios = paths.some((file) => file.startsWith("apps/ios/"));
  const android = paths.some((file) => file.startsWith("apps/android/"));
  const behaviorOnly = paths.length > 0 && paths.every((file) => file.startsWith("clients/behavior/"));
  return {
    ios,
    android,
    splitViolation: ios && android && !behaviorOnly
  };
}
