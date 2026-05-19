import { type ErrorCatalogKey, getErrorMessage } from "./errorCatalog.js";

export type NoticeSeverity = "info" | "warning" | "error";

export type TransientNotice = {
  id: string;
  message: string;
  catalogKey?: ErrorCatalogKey;
  severity: NoticeSeverity;
  fingerprint: string;
  presentedAtMs: number;
};

export type InlineNotice = {
  anchorId: string;
  message: string;
  catalogKey?: ErrorCatalogKey;
  severity: NoticeSeverity;
};

export type NoticeBusState = {
  transient?: TransientNotice;
  inlineByAnchor: Record<string, InlineNotice>;
};

export type NoticeListener = (state: NoticeBusState) => void;

const DEFAULT_DEDUPE_MS = 2000;

let nextNoticeId = 1;

function makeNoticeId(): string {
  nextNoticeId += 1;
  return `notice-${nextNoticeId}`;
}

export class NoticeBus {
  private state: NoticeBusState = { inlineByAnchor: {} };
  private readonly listeners = new Set<NoticeListener>();
  private lastTransientFingerprint?: string;
  private lastTransientAtMs = 0;

  getState(): NoticeBusState {
    return this.state;
  }

  subscribe(listener: NoticeListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  presentTransient(input: {
    catalogKey?: ErrorCatalogKey;
    message?: string;
    severity?: NoticeSeverity;
    fingerprint: string;
    dedupeMs?: number;
  }): void {
    const message =
      input.message ?? (input.catalogKey ? getErrorMessage(input.catalogKey) : getErrorMessage("unknown"));
    const now = Date.now();
    const dedupeMs = input.dedupeMs ?? DEFAULT_DEDUPE_MS;

    if (
      this.state.transient &&
      this.lastTransientFingerprint === input.fingerprint &&
      now - this.lastTransientAtMs < dedupeMs
    ) {
      return;
    }

    this.lastTransientFingerprint = input.fingerprint;
    this.lastTransientAtMs = now;
    this.state = {
      ...this.state,
      transient: {
        id: makeNoticeId(),
        message,
        catalogKey: input.catalogKey,
        severity: input.severity ?? "error",
        fingerprint: input.fingerprint,
        presentedAtMs: now
      }
    };
    this.emit();
  }

  dismissTransient(): void {
    if (!this.state.transient) {
      return;
    }
    this.state = { ...this.state, transient: undefined };
    this.emit();
  }

  presentInline(input: {
    anchorId: string;
    catalogKey?: ErrorCatalogKey;
    message?: string;
    severity?: NoticeSeverity;
  }): void {
    const message =
      input.message ?? (input.catalogKey ? getErrorMessage(input.catalogKey) : getErrorMessage("unknown"));
    this.state = {
      ...this.state,
      inlineByAnchor: {
        ...this.state.inlineByAnchor,
        [input.anchorId]: {
          anchorId: input.anchorId,
          message,
          catalogKey: input.catalogKey,
          severity: input.severity ?? "error"
        }
      }
    };
    this.emit();
  }

  clearInline(anchorId: string): void {
    if (!this.state.inlineByAnchor[anchorId]) {
      return;
    }
    const { [anchorId]: _removed, ...rest } = this.state.inlineByAnchor;
    this.state = { ...this.state, inlineByAnchor: rest };
    this.emit();
  }
}

export function createNoticeBus(): NoticeBus {
  return new NoticeBus();
}
