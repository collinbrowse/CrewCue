/** Request path without its query string. Queries carry OAuth codes and search text, so logs drop them. */
export function logSafeUrl(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
}
