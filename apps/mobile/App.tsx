import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import type { RaceRoom } from "@crewcue/contracts";
import { loadMobileConfig } from "./src/config";
import { useAuth } from "./src/auth/useAuth";
import { ApiError, createApiClient } from "./src/api/client";

export default function App(): ReactElement {
  const configResult = useMemo(() => loadMobileConfig(), []);

  if (!configResult.ok) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Configuration missing</Text>
          <Text style={styles.body}>
            The mobile app cannot start because the following env vars are missing:
          </Text>
          {configResult.missing.map((name) => (
            <Text key={name} style={styles.code}>
              {name}
            </Text>
          ))}
          <Text style={styles.body}>
            Copy <Text style={styles.code}>apps/mobile/.env.example</Text> to{" "}
            <Text style={styles.code}>apps/mobile/.env</Text> and restart Expo.
          </Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return <AuthedShell baseUrl={configResult.config.apiBaseUrl} auth0={configResult.config} />;
}

type AuthedShellProps = {
  baseUrl: string;
  auth0: { auth0Domain: string; auth0ClientId: string; auth0Audience: string };
};

function AuthedShell({ baseUrl, auth0 }: AuthedShellProps): ReactElement {
  const auth = useAuth({
    domain: auth0.auth0Domain,
    clientId: auth0.auth0ClientId,
    audience: auth0.auth0Audience
  });

  const [room, setRoom] = useState<RaceRoom | undefined>(undefined);
  const [roomDetail, setRoomDetail] = useState<
    { room: RaceRoom; permissions: Record<string, boolean> } | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const createRoom = useCallback(async () => {
    if (!auth.accessToken || !auth.claims?.sub) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const teamId = auth.claims.teamIds?.[0] ?? "mobile-smoketest-team";
      const created = await client.createRaceRoom({
        teamId,
        athleteId: auth.claims.sub,
        name: `Mobile smoke ${new Date().toISOString().slice(0, 16)}`,
        creatorRole: "athlete"
      });
      setRoom(created);
      setRoomDetail(undefined);
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(`${err.status} ${err.message}`);
      } else if (err instanceof Error) {
        setApiError(err.message);
      } else {
        setApiError("Unknown error");
      }
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, auth.claims, baseUrl]);

  const markEntitlementPaid = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const entitlement = await client.updateEntitlement(room.id, "paid");
      setRoom((r) => (r ? { ...r, entitlement } : r));
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(`${err.status} ${err.message}`);
      } else if (err instanceof Error) {
        setApiError(err.message);
      } else {
        setApiError("Unknown error");
      }
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl]);

  const fetchRoomDetails = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const detail = await client.getRaceRoom(room.id);
      setRoomDetail(detail);
      setRoom(detail.room);
    } catch (err) {
      if (err instanceof ApiError) {
        setApiError(`${err.status} ${err.message}`);
      } else if (err instanceof Error) {
        setApiError(err.message);
      } else {
        setApiError("Unknown error");
      }
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>CrewCue</Text>
          <Text style={styles.subtitle}>Chunk C smoke test</Text>

          <Text style={styles.label}>API base</Text>
          <Text style={styles.code}>{baseUrl}</Text>

          <Text style={styles.label}>Redirect URI</Text>
          <Text style={styles.code}>{auth.redirectUri}</Text>

          <Text style={styles.label}>Auth status</Text>
          <Text style={styles.value}>{auth.status}</Text>

          {auth.status === "bootstrapping" ? (
            <ActivityIndicator color="#f9fafb" style={{ marginTop: 12 }} />
          ) : null}

          {auth.status === "authenticated" && auth.claims ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.label}>Subject</Text>
              <Text style={styles.code}>{auth.claims.sub}</Text>
              {auth.claims.email ? (
                <>
                  <Text style={styles.label}>Email</Text>
                  <Text style={styles.code}>{auth.claims.email}</Text>
                </>
              ) : null}
              <Text style={styles.label}>team_ids</Text>
              <Text style={styles.code}>{JSON.stringify(auth.claims.teamIds ?? null)}</Text>
              <Text style={styles.label}>room_roles</Text>
              <Text style={styles.code}>{JSON.stringify(auth.claims.roomRoles ?? null)}</Text>
            </View>
          ) : null}

          {auth.error ? (
            <>
              <Text style={styles.label}>Auth error</Text>
              <Text style={styles.errorText}>{auth.error}</Text>
            </>
          ) : null}

          <View style={{ marginTop: 16, gap: 8 }}>
            {auth.status !== "authenticated" ? (
              <Pressable
                style={styles.primaryButton}
                onPress={auth.signIn}
                disabled={auth.status === "authenticating"}
              >
                <Text style={styles.primaryButtonLabel}>
                  {auth.status === "authenticating" ? "Opening Auth0..." : "Sign in with Auth0"}
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.primaryButton} onPress={createRoom} disabled={busy}>
                  <Text style={styles.primaryButtonLabel}>
                    {busy ? "Calling API..." : "Create race room (staging)"}
                  </Text>
                </Pressable>
                {room ? (
                  <>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={markEntitlementPaid}
                      disabled={busy || room.entitlement.status === "paid"}
                    >
                      <Text style={styles.secondaryButtonLabel}>
                        {room.entitlement.status === "paid"
                          ? "Entitlement already paid"
                          : "Mark entitlement paid (staging)"}
                      </Text>
                    </Pressable>
                    <Pressable style={styles.secondaryButton} onPress={fetchRoomDetails} disabled={busy}>
                      <Text style={styles.secondaryButtonLabel}>Fetch room (GET)</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable style={styles.secondaryButton} onPress={auth.signOut}>
                  <Text style={styles.secondaryButtonLabel}>Sign out</Text>
                </Pressable>
              </>
            )}
          </View>

          {apiError ? (
            <>
              <Text style={styles.label}>API error</Text>
              <Text style={styles.errorText}>{apiError}</Text>
            </>
          ) : null}

          {room ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>Created room</Text>
              <Text style={styles.code}>{room.id}</Text>
              <Text style={styles.label}>Status / entitlement</Text>
              <Text style={styles.code}>
                {room.status} / {room.entitlement.status}
              </Text>
            </View>
          ) : null}

          {roomDetail ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>GET /race-rooms/:id</Text>
              <Text style={styles.body}>Name</Text>
              <Text style={styles.code}>{roomDetail.room.name}</Text>
              <Text style={styles.body}>Status / entitlement</Text>
              <Text style={styles.code}>
                {roomDetail.room.status} / {roomDetail.room.entitlement.status}
              </Text>
              <Text style={styles.body}>Permissions</Text>
              <Text style={styles.code}>{JSON.stringify(roomDetail.permissions, null, 2)}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a"
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 16
  },
  card: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: "#111827",
    gap: 4
  },
  title: {
    color: "#f9fafb",
    fontSize: 26,
    fontWeight: "700"
  },
  subtitle: {
    color: "#9ca3af",
    fontSize: 14,
    marginBottom: 12
  },
  label: {
    color: "#9ca3af",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 10
  },
  value: {
    color: "#f9fafb",
    fontSize: 16
  },
  code: {
    color: "#e5e7eb",
    fontSize: 13,
    fontFamily: "Menlo"
  },
  body: {
    color: "#d1d5db",
    fontSize: 14,
    marginTop: 6
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center"
  },
  primaryButtonLabel: {
    color: "#f9fafb",
    fontSize: 16,
    fontWeight: "600"
  },
  secondaryButton: {
    backgroundColor: "#1f2937",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center"
  },
  secondaryButtonLabel: {
    color: "#d1d5db",
    fontSize: 14
  }
});
