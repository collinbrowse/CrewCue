import { type ErrorCatalogKey, getErrorMessage } from "./errorCatalog.js";

export type MappedError = {
  key: ErrorCatalogKey;
  message: string;
};

export type ApiErrorLike = {
  status?: number;
  message?: string;
  body?: unknown;
};

function readBodyMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const o = body as Record<string, unknown>;
  if (typeof o.message === "string" && o.message.length > 0) {
    return o.message;
  }
  if (typeof o.error === "string" && o.error.length > 0) {
    return o.error;
  }
  return undefined;
}

function resolveKey(error: ApiErrorLike, detail?: string): ErrorCatalogKey {
  const status = error.status;
  const haystack = `${detail ?? ""} ${error.message ?? ""}`.toLowerCase();

  if (status === 403) {
    return "forbidden";
  }
  if (status === 404) {
    return "notFound";
  }
  if (status === 400 || status === 422) {
    return "invalidInput";
  }
  if (haystack.includes("network") || haystack.includes("offline") || haystack.includes("failed to fetch")) {
    return "networkOffline";
  }
  if (haystack.includes("location") && haystack.includes("permission")) {
    return "locationPermissionDenied";
  }
  if (haystack.includes("location")) {
    return "locationUnavailable";
  }
  return "unknown";
}

/** Map API/unknown errors to catalog keys. Never exposes HTTP status in the message. */
export function mapApiError(error: unknown, fallbackKey: ErrorCatalogKey = "unknown"): MappedError {
  if (error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError") {
    const key: ErrorCatalogKey = "unknown";
    return { key, message: getErrorMessage(key) };
  }

  if (error && typeof error === "object") {
    const e = error as ApiErrorLike;
    const detail = readBodyMessage(e.body);
    const key = resolveKey(e, detail);
    return { key, message: getErrorMessage(key) };
  }

  if (error instanceof Error) {
    const key = resolveKey({ message: error.message });
    return { key, message: getErrorMessage(key) };
  }

  return { key: fallbackKey, message: getErrorMessage(fallbackKey) };
}
