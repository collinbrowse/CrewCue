import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { MobileShellSessionHeader } from "../components/MobileShellSessionHeader";
import { OperationalStatusRail } from "../components/OperationalStatusRail";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function OperateStatusScreen(): ReactElement {
  const s = useAuthedShell();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0f172a" }} contentContainerStyle={s.styles.scroll}>
      <View style={s.styles.card}>
        <Text style={s.styles.title}>Operate Status</Text>
        <Text style={s.styles.subtitle}>Focused status rail and session telemetry</Text>
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
      </View>
    </ScrollView>
  );
}
