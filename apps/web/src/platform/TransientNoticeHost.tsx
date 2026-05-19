import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import type { TransientNotice } from "@crewcue/platform-client";
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

const bannerStyle: CSSProperties = {
  pointerEvents: "auto",
  background: "var(--card, #fff)",
  color: "var(--text, #111)",
  border: "1px solid var(--accent-border, #d8d1c4)",
  borderRadius: 14,
  padding: "12px 14px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
  animation: "crewcueNoticeIn 220ms ease-out",
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit"
};

export function TransientNoticeHost(): ReactElement | null {
  const [notice, setNotice] = useState<TransientNotice | undefined>(undefined);

  useEffect(() => {
    return appNoticeBus.subscribe((state) => {
      setNotice(state.transient);
    });
  }, []);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const id = window.setTimeout(() => appNoticeBus.dismissTransient(), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  if (!notice) {
    return null;
  }

  return (
    <>
      <style>{`
        @keyframes crewcueNoticeIn {
          from { opacity: 0; transform: translateY(-12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div style={hostStyle} role="alert">
        <button type="button" style={bannerStyle} onClick={() => appNoticeBus.dismissTransient()}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.7, marginBottom: 4 }}>CrewCue</div>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{notice.message}</div>
        </button>
      </div>
    </>
  );
}
