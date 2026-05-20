import catalogJson from "../errors/en.json" with { type: "json" };

export type ErrorCatalogKey = keyof typeof catalogJson;

const catalog: Record<string, string> = catalogJson;

export function isErrorCatalogKey(value: string): value is ErrorCatalogKey {
  return Object.prototype.hasOwnProperty.call(catalog, value);
}

export function getErrorMessage(key: ErrorCatalogKey): string {
  const message = catalog[key];
  if (typeof message !== "string" || message.length === 0) {
    throw new Error(`Missing catalog entry for key: ${key}`);
  }
  return message;
}

export function listErrorCatalogKeys(): ErrorCatalogKey[] {
  return Object.keys(catalog) as ErrorCatalogKey[];
}
