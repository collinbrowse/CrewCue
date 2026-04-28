import type { ReactElement } from "react";
import { ScrollView, Text } from "react-native";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { OperationalStatusRail } from "../components/OperationalStatusRail";
import { Ws5ResiliencePanel } from "../components/Ws5ResiliencePanel";
import { DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OperateStatusScreen(): ReactElement {
  const s = useAuthedShell();

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={s.styles.scroll}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Operate Status</Text>
        <Text style={s.styles.subtitle}>Operational health and sync telemetry</Text>
        <MobileShellSessionHeader
          styles={s.styles}
          baseUrl={s.baseUrl}
          redirectUri={s.auth.redirectUri}
          authStatus={s.auth.status}
          claims={s.auth.claims}
          authError={s.auth.error}
          pendingOutboxCount={s.pendingOutboxCount}
          outboxTotal={s.outbox.length}
          appState={s.appState}
        />
        <OperationalStatusRail
          styles={s.styles}
          pendingOutboxCount={s.pendingOutboxCount}
          lastError={s.apiError}
          lastStatusMessage={s.syncStatusMessage}
          projectionStaleSeconds={s.projection?.secondsSinceLastAcceptedPing}
        />
        <Ws5ResiliencePanel
          styles={s.styles}
          disableRefresh={!s.room}
          disablePushDiagnostics={!s.room || s.room.status !== "active"}
          refreshDisabledHint={!s.room ? "Create a room from Operate before refreshing WS5 telemetry." : undefined}
          pushDisabledHint={
            s.room && s.room.status !== "active"
              ? "Activate the room before pushing queue diagnostics snapshots."
              : undefined
          }
          busy={s.busy}
          queueDiagnostics={s.queueDiagnostics}
          mergeRecords={s.mergeRecords}
          onRefreshTelemetry={() => {
            void s.onRefreshWs5Telemetry();
          }}
          onPushDiagnostics={() => {
            void s.onPushQueueDiagnosticsSnapshot();
          }}
        />
      </DSCard>
    </ScrollView>
  );
}
