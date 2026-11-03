type HeaderValue = string | string[] | undefined;

/**
 * Address to use for a per-visitor rate limit.
 *
 * The API sits behind Railway's public HTTP edge. The socket peer is that
 * proxy, so `request.ip` is the same for every caller and a per-IP bucket
 * becomes a global cap. The edge overwrites `X-Real-IP` with the visitor
 * address (a client-supplied value is replaced, not appended). Hop count for
 * `X-Forwarded-For` is not stable, so this does not use `trustProxy`.
 * When the header is missing or not an IP, the socket address is the fallback
 * (local runs and tests).
 */
export function clientAddress(request: {
  ip?: string;
  headers?: { [key: string]: HeaderValue };
}): string {
  const header = request.headers?.["x-real-ip"];
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw === "string") {
    const candidate = raw.trim();
    if (isIpAddress(candidate)) {
      return candidate;
    }
  }
  const socket = typeof request.ip === "string" ? request.ip.trim() : "";
  return socket.length > 0 ? socket : "unknown";
}

function isIpAddress(value: string): boolean {
  if (value.length === 0 || value.length > 45) {
    return false;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    return v4.slice(1).every((part) => {
      if (part.length > 1 && part.startsWith("0")) {
        return false;
      }
      return Number(part) <= 255;
    });
  }
  if (!value.includes(":") || !/^[0-9a-fA-F:]+$/.test(value)) {
    return false;
  }
  return value.split("::").length <= 2 && /[0-9a-fA-F]/.test(value);
}
