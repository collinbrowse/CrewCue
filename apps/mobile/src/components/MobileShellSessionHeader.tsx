import type { ReactElement } from "react";
import { ActivityIndicator, Text, View, type AppStateStatus } from "react-native";
import type { DecodedAccessClaims } from "../auth/jwt";
import type { AuthStatus } from "../auth/useAuth";

type Props = {
  styles: any;
  baseUrl: string;
  redirectUri: string;
  authStatus: AuthStatus;
  claims?: DecodedAccessClaims;
  authError?: string;
  pendingOutboxCount: number;
  outboxTotal: number;
  appState: AppStateStatus;
};

export function MobileShellSessionHeader({
  styles,
  baseUrl,
  redirectUri,
  authStatus,
  claims,
  authError,
  pendingOutboxCount,
  outboxTotal,
  appState
}: Props): ReactElement {
  return (
    <>
      <Text style={styles.label}>API base</Text>
      <Text style={styles.code}>{baseUrl}</Text>

      <Text style={styles.label}>Redirect URI</Text>
      <Text style={styles.code}>{redirectUri}</Text>

      <Text style={styles.label}>Auth status</Text>
      <Text style={styles.value}>{authStatus}</Text>

      <Text style={styles.label}>Outbox count</Text>
      <Text style={styles.code}>
        {pendingOutboxCount} pending / {outboxTotal} total
      </Text>

      <Text style={styles.label}>App state</Text>
      <Text style={styles.code}>{appState}</Text>

      {authStatus === "bootstrapping" ? (
        <ActivityIndicator color="#f9fafb" style={{ marginTop: 12 }} />
      ) : null}

      {authStatus === "authenticated" && claims ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>Subject</Text>
          <Text style={styles.code}>{claims.sub}</Text>
          {claims.email ? (
            <>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.code}>{claims.email}</Text>
            </>
          ) : null}
          <Text style={styles.label}>team_ids</Text>
          <Text style={styles.code}>{JSON.stringify(claims.teamIds ?? null)}</Text>
          <Text style={styles.label}>room_roles</Text>
          <Text style={styles.code}>{JSON.stringify(claims.roomRoles ?? null)}</Text>
        </View>
      ) : null}

      {authError ? (
        <>
          <Text style={styles.label}>Auth error</Text>
          <Text style={styles.errorText}>{authError}</Text>
        </>
      ) : null}
    </>
  );
}
