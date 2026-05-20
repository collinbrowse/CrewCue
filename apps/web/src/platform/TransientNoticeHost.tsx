import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type TouchEvent } from "react";
import {
  DEFAULT_NOTICE_SWIPE_DISMISS_DY,
  DEFAULT_NOTICE_SWIPE_DISMISS_VY,
  shouldDismissTransientBySwipe,
  type TransientNotice
} from "@crewcue/platform-client";
import { appNoticeBus } from "./runtime";

const hostStyle: CSSProperties = {
  position: "fixed",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 10000,
  width: "min(420px, calc(100vw - 24px))",
  pointerEvents: "none"
};

export function TransientNoticeHost(): ReactElement | null {
  const [notice, setNotice] = useState<TransientNotice | undefined>(undefined);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const touchStartAtMs = useRef<number | null>(null);

  useEffect(() => {
    return appNoticeBus.subscribe((state) => {
      setNotice(state.transient);
      setDragOffset(0);
      setIsDragging(false);
    });
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const id = window.setTimeout(() => appNoticeBus.dismissTransient(), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const dismissAnimated = () => {
    setDragOffset(-80);
    window.setTimeout(() => appNoticeBus.dismissTransient(), 160);
  };

  const onTouchStart = (event: TouchEvent) => {
    touchStartY.current = event.touches[0]?.clientY ?? null;
    touchStartAtMs.current = Date.now();
    setIsDragging(true);
  };

  const onTouchMove = (event: TouchEvent) => {
    const startY = touchStartY.current;
    const currentY = event.touches[0]?.clientY;
    if (startY === null || currentY === undefined) {
      return;
    }
    const dy = currentY - startY;
    if (dy < 0) {
      setDragOffset(dy);
    }
  };

  const onTouchEnd = (event: TouchEvent) => {
    const startY = touchStartY.current;
    const startedAtMs = touchStartAtMs.current;
    touchStartY.current = null;
    touchStartAtMs.current = null;
    setIsDragging(false);
    const endY = event.changedTouches[0]?.clientY;
    if (startY === null || endY === undefined) {
      setDragOffset(0);
      return;
    }
    const dy = endY - startY;
    const elapsedSeconds = startedAtMs === null ? 1 : Math.max(0.05, (Date.now() - startedAtMs) / 1000);
    const vy = dy / elapsedSeconds;
    if (
      shouldDismissTransientBySwipe(dy, vy, {
        dismissDy: DEFAULT_NOTICE_SWIPE_DISMISS_DY,
        dismissVy: DEFAULT_NOTICE_SWIPE_DISMISS_VY
      })
    ) {
      dismissAnimated();
      return;
    }
    setDragOffset(0);
  };

  if (!notice) {
    return null;
  }

  const bannerStyle: CSSProperties = {
    pointerEvents: "auto",
    background: "var(--card, #fff)",
    color: "var(--text, #111)",
    border: "1px solid var(--accent-border, #d8d1c4)",
    borderRadius: 14,
    padding: "12px 14px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
    font: "inherit",
    touchAction: "pan-y",
    transform: `translateY(${dragOffset}px)`,
    opacity: dragOffset < -20 ? Math.max(0.35, 1 + dragOffset / 80) : 1,
    transition: isDragging ? undefined : "transform 160ms ease, opacity 160ms ease",
    animation: dragOffset === 0 && !isDragging ? "crewcueNoticeIn 220ms ease-out" : undefined
  };

  return (
    <>
      <style>{`
        @keyframes crewcueNoticeIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={hostStyle} role="alert">
        <button
          type="button"
          style={bannerStyle}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onClick={() => dismissAnimated()}
        >
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 4 }}>CrewCue</div>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{notice.message}</div>
        </button>
      </div>
    </>
  );
}
