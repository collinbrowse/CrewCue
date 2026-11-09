/**
 * Chat photo storage (ADR 0011).
 *
 * Production: a Railway (S3-compatible) bucket. Clients read photos through short-lived
 * presigned GET URLs; the API uploads and deletes with presigned PUT/DELETE.
 * Local dev and tests (no bucket configured, not production): an in-memory store served by
 * `GET /chat/photos/*` with an HMAC-signed, expiring query string.
 */
import { createHmac, randomBytes, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { presignS3Url, type S3BucketConfig } from "./s3Presign.js";

export const CHAT_PHOTO_URL_TTL_SECONDS = 60 * 60;
export const CHAT_PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/heic", "image/webp"] as const;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp"
};

export interface ChatPhotoStore {
  readonly kind: "bucket" | "memory";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** A URL the client can GET without auth headers. Relative (API path) for the memory store. */
  url(key: string): string;
  /** Type and size of a stored photo, or undefined when the key holds nothing. */
  stat(key: string): Promise<{ contentType: string; byteSize: number } | undefined>;
  delete(keys: readonly string[]): Promise<number>;
}

type FetchLike = (url: string, init: { method: string; headers?: Record<string, string>; body?: Buffer }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
}>;

export function readChatPhotoBucketConfig(env: NodeJS.ProcessEnv = process.env): S3BucketConfig | undefined {
  const bucket = env.CHAT_PHOTO_BUCKET?.trim();
  const endpoint = env.CHAT_PHOTO_ENDPOINT?.trim();
  const accessKeyId = env.CHAT_PHOTO_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.CHAT_PHOTO_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return undefined;
  return {
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    region: env.CHAT_PHOTO_REGION?.trim() || "auto",
    urlStyle: env.CHAT_PHOTO_URL_STYLE?.trim() === "path" ? "path" : "virtual"
  };
}

export function bucketChatPhotoStore(config: S3BucketConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): ChatPhotoStore {
  return {
    kind: "bucket",
    async put(key, bytes, contentType) {
      const res = await fetchImpl(presignS3Url(config, "PUT", key, 300), {
        method: "PUT",
        headers: { "content-type": contentType },
        body: bytes
      });
      if (!res.ok) throw new Error(`chat photo upload failed with ${res.status}`);
    },
    url(key) {
      return presignS3Url(config, "GET", key, CHAT_PHOTO_URL_TTL_SECONDS);
    },
    async stat(key) {
      const res = await fetchImpl(presignS3Url(config, "HEAD", key, 300), { method: "HEAD" });
      if (!res.ok) return undefined;
      return {
        contentType: res.headers.get("content-type") ?? "image/jpeg",
        byteSize: Number(res.headers.get("content-length") ?? "0")
      };
    },
    async delete(keys) {
      let deleted = 0;
      for (const key of keys) {
        const res = await fetchImpl(presignS3Url(config, "DELETE", key, 300), { method: "DELETE" });
        if (res.ok || res.status === 404) deleted += 1;
      }
      return deleted;
    }
  };
}

type MemoryPhoto = { bytes: Buffer; contentType: string };

export class MemoryChatPhotoStore implements ChatPhotoStore {
  readonly kind = "memory" as const;
  private readonly photos = new Map<string, MemoryPhoto>();
  private readonly secret = randomBytes(32);

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.photos.set(key, { bytes, contentType });
  }

  url(key: string, now: number = Date.now()): string {
    const exp = Math.floor(now / 1000) + CHAT_PHOTO_URL_TTL_SECONDS;
    return `/chat/photos/${key}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }

  async stat(key: string): Promise<{ contentType: string; byteSize: number } | undefined> {
    const photo = this.photos.get(key);
    return photo ? { contentType: photo.contentType, byteSize: photo.bytes.length } : undefined;
  }

  async delete(keys: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) if (this.photos.delete(key)) deleted += 1;
    return deleted;
  }

  /** The photo when the signature is valid and unexpired. */
  read(key: string, exp: string | undefined, sig: string | undefined, now: number = Date.now()): MemoryPhoto | undefined {
    const expSeconds = Number(exp);
    if (!sig || !Number.isFinite(expSeconds) || expSeconds * 1000 < now) return undefined;
    const expected = Buffer.from(this.sign(key, expSeconds));
    const provided = Buffer.from(sig);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;
    return this.photos.get(key);
  }

  private sign(key: string, exp: number): string {
    return createHmac("sha256", this.secret).update(`${key}|${exp}`).digest("hex");
  }
}

let activeStore: ChatPhotoStore | null | undefined;

/** The configured store, or null when photos are unavailable (production without a bucket). */
export function chatPhotoStore(): ChatPhotoStore | null {
  if (activeStore !== undefined) return activeStore;
  const bucket = readChatPhotoBucketConfig();
  if (bucket) {
    activeStore = bucketChatPhotoStore(bucket);
  } else if (process.env.NODE_ENV === "production") {
    activeStore = null;
  } else {
    activeStore = new MemoryChatPhotoStore();
  }
  return activeStore;
}

export function setChatPhotoStoreForTests(store: ChatPhotoStore | null | undefined): void {
  activeStore = store;
}

/** Keys are rooms/{roomId}/{sha256(userId) prefix}/{uuid}.{ext}, so a sender can only attach their own upload. */
export function newChatPhotoKey(roomId: string, userId: string, contentType: string): string {
  return `rooms/${encodeURIComponent(roomId)}/${uploaderSegment(userId)}/${randomUUID()}.${EXTENSIONS[contentType] ?? "bin"}`;
}

export function chatPhotoKeyBelongsTo(key: string, roomId: string, userId: string): boolean {
  const prefix = `rooms/${encodeURIComponent(roomId)}/${uploaderSegment(userId)}/`;
  return key.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|png|heic|webp)$/.test(key.slice(prefix.length));
}

function uploaderSegment(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 24);
}
