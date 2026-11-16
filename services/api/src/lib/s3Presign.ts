/**
 * AWS Signature V4 query-string presigning for S3-compatible buckets (Railway buckets).
 * Small on purpose: chat photos need presigned GET for clients plus PUT/DELETE from the API,
 * which does not justify the AWS SDK.
 */
import { createHash, createHmac } from "node:crypto";

export type S3BucketConfig = {
  /** e.g. https://t3.storageapi.dev */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Railway buckets are virtual-hosted ({bucket}.{endpoint host}). */
  urlStyle: "virtual" | "path";
};

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKeyPath(key: string): string {
  return key.split("/").map(rfc3986).join("/");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(now: Date): { date: string; stamp: string } {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { stamp: iso, date: iso.slice(0, 8) };
}

/** Presigned URL for one object. Signs only the host header; the payload is unsigned. */
export function presignS3Url(
  config: S3BucketConfig,
  method: "GET" | "HEAD" | "PUT" | "DELETE",
  key: string,
  expiresSeconds: number,
  now: Date = new Date()
): string {
  const endpoint = new URL(config.endpoint);
  const host = config.urlStyle === "virtual" ? `${config.bucket}.${endpoint.host}` : endpoint.host;
  const path =
    config.urlStyle === "virtual" ? `/${encodeKeyPath(key)}` : `/${rfc3986(config.bucket)}/${encodeKeyPath(key)}`;
  const { stamp, date } = amzDate(now);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const params: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"]
  ];
  const query = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [method, path, query, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex")
  ].join("\n");
  const kDate = hmac(`AWS4${config.secretAccessKey}`, date);
  const kRegion = hmac(kDate, config.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  return `${endpoint.protocol}//${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
