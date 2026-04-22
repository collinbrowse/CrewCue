import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
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
import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointPlan,
  CrewAssignment,
  CrewTask,
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  SyncStatus
} from "@crewcue/contracts";
import { loadMobileConfig } from "./src/config";
import { useAuth } from "./src/auth/useAuth";
import {
  ApiError,
  createApiClient,
  type ApiClient,
  type AssignTaskInput,
  type PostPingInput
} from "./src/api/client";
import {
  isPendingHeartbeat,
  postSyncHeartbeatWithRetry,
  type PendingHeartbeat
} from "./src/sync/pendingHeartbeat";
import {
  dequeue as dequeueOutbox,
  enqueue as enqueueOutbox,
  list as listOutbox,
  type OutboxOperation
} from "./src/sync/outboxStore";

const MOBILE_SMOKE_DEVICE_ID = "mobile-smoke-device";
const DEFAULT_PENDING_QUEUE_COUNT = 1;

type OutboxPingPayload = { roomId: string } & PostPingInput;
type OutboxProtocolPayload = {
  roomId: string;
  checkpointId: string;
  category: ProtocolNote["category"];
  body: string;
};
type OutboxTaskPayload =
  | ({ roomId: string; taskId: string; action: "start" })
  | ({ roomId: string; taskId: string; action: "complete" })
  | ({ roomId: string; taskId: string; action: "assign" } & AssignTaskInput);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOutboxPingPayload(value: unknown): value is OutboxPingPayload {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    typeof value.recordedAt === "string" &&
    (value.horizontalAccuracyMeters === undefined || typeof value.horizontalAccuracyMeters === "number") &&
    (value.uploadIntervalSeconds === undefined || typeof value.uploadIntervalSeconds === "number")
  );
}

function isOutboxProtocolPayload(value: unknown): value is OutboxProtocolPayload {
  return (
    isRecord(value) &&
    typeof value.roomId === "string" &&
    typeof value.checkpointId === "string" &&
    typeof value.category === "string" &&
    (value.category === "heat" ||
      value.category === "nutrition" ||
      value.category === "blister" ||
      value.category === "other") &&
    typeof value.body === "string"
  );
}

function isOutboxTaskPayload(value: unknown): value is OutboxTaskPayload {
  if (!isRecord(value) || typeof value.roomId !== "string" || typeof value.taskId !== "string") {
    return false;
  }

  if (value.action === "start" || value.action === "complete") {
    return true;
  }

  return (
    value.action === "assign" &&
    typeof value.assigneeUserId === "string" &&
    typeof value.assigneeRole === "string" &&
    (value.assigneeRole === "athlete" ||
      value.assigneeRole === "crew_member" ||
      value.assigneeRole === "crew_chief" ||
      value.assigneeRole === "team_manager")
  );
}

function describeOutboxOperation(operation: OutboxOperation): string {
  if (operation.type === "ping") {
    if (isPendingHeartbeat(operation.payload)) {
      return "sync heartbeat";
    }

    if (isOutboxPingPayload(operation.payload)) {
      return "athlete ping";
    }
  }

  if (operation.type === "protocol") {
    return "protocol note";
  }

  if (operation.type === "task" && isOutboxTaskPayload(operation.payload)) {
    return `task ${operation.payload.action}`;
  }

  return operation.type;
}

async function processOutboxOperation(
  client: ApiClient,
  operation: OutboxOperation
): Promise<{ roomId: string; label: string }> {
  if (operation.type === "ping") {
    if (isPendingHeartbeat(operation.payload)) {
      await client.postSyncHeartbeat(operation.payload.roomId, operation.payload);
      return { roomId: operation.payload.roomId, label: "sync heartbeat" };
    }

    if (isOutboxPingPayload(operation.payload)) {
      const { roomId, ...payload } = operation.payload;
      await client.postPing(roomId, payload);
      return { roomId, label: "athlete ping" };
    }
  }

  if (operation.type === "protocol" && isOutboxProtocolPayload(operation.payload)) {
    const { roomId, checkpointId, category, body } = operation.payload;
    await client.postProtocolNote(roomId, { checkpointId, category, body });
    return { roomId, label: "protocol note" };
  }

  if (operation.type === "task" && isOutboxTaskPayload(operation.payload)) {
    if (operation.payload.action === "assign") {
      await client.assignTask(operation.payload.roomId, operation.payload.taskId, {
        assigneeUserId: operation.payload.assigneeUserId,
        assigneeRole: operation.payload.assigneeRole
      });
      return { roomId: operation.payload.roomId, label: "task assign" };
    }

    if (operation.payload.action === "start") {
      await client.startTask(operation.payload.roomId, operation.payload.taskId);
      return { roomId: operation.payload.roomId, label: "task start" };
    }

    await client.completeTask(operation.payload.roomId, operation.payload.taskId);
    return { roomId: operation.payload.roomId, label: "task complete" };
  }

  throw new Error(`Unsupported outbox payload for ${operation.type}.`);
}

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
  const [lastPing, setLastPing] = useState<
    AthletePingAcceptedResponse | AthletePingRejectedResponse | undefined
  >(undefined);
  const [projection, setProjection] = useState<RaceRoomProjection | undefined>(undefined);
  const [projectionPollEnabled, setProjectionPollEnabled] = useState(false);
  const [projectionPolledAt, setProjectionPolledAt] = useState<string | undefined>(undefined);
  const [taskBoard, setTaskBoard] = useState<
    { checkpointPlans: CheckpointPlan[]; tasks: CrewTask[]; assignments: CrewAssignment[] } | undefined
  >(undefined);
  const [lastProtocolNote, setLastProtocolNote] = useState<ProtocolNote | undefined>(undefined);
  const [timeline, setTimeline] = useState<OpsTimelineEvent[] | undefined>(undefined);
  const [syncHealth, setSyncHealth] = useState<SyncStatus | undefined>(undefined);
  const [outbox, setOutbox] = useState<OutboxOperation[]>([]);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  const refreshOutbox = useCallback(async () => {
    try {
      setOutbox(await listOutbox());
    } catch {
      setOutbox([]);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void listOutbox()
      .then((value) => {
        if (isMounted) {
          setOutbox(value);
        }
      })
      .catch(() => {
        if (isMounted) {
          setOutbox([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const pollProjectionQuiet = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      setProjection(await client.getProjection(room.id));
      setProjectionPolledAt(new Date().toISOString());
    } catch {
      /* background poll — avoid spamming apiError */
    }
  }, [auth.accessToken, room, baseUrl]);

  useEffect(() => {
    if (!projectionPollEnabled || room?.status !== "active" || !auth.accessToken) {
      return;
    }
    void pollProjectionQuiet();
    const id = setInterval(() => {
      void pollProjectionQuiet();
    }, 8000);
    return () => clearInterval(id);
  }, [projectionPollEnabled, room?.status, room?.id, auth.accessToken, pollProjectionQuiet]);

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
      setLastPing(undefined);
      setProjection(undefined);
      setProjectionPollEnabled(false);
      setProjectionPolledAt(undefined);
      setTaskBoard(undefined);
      setLastProtocolNote(undefined);
      setTimeline(undefined);
      setSyncHealth(undefined);
      setSyncStatusMessage(undefined);
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

  const activateRoom = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const eventEndsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const activated = await client.activateRaceRoom(room.id, { eventEndsAt });
      setRoom(activated);
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

  const sendPing = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const result = await client.postPing(room.id, {
        latitude: 37.7749,
        longitude: -122.4194,
        recordedAt: new Date().toISOString(),
        uploadIntervalSeconds: 30
      });
      setLastPing(result);
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

  const fetchProjection = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      setProjection(await client.getProjection(room.id));
      setProjectionPolledAt(new Date().toISOString());
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

  const postSyncHeartbeat = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    setSyncStatusMessage(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const result = await postSyncHeartbeatWithRetry(client, {
        roomId: room.id,
        deviceId: MOBILE_SMOKE_DEVICE_ID,
        pendingQueueCount: DEFAULT_PENDING_QUEUE_COUNT
      });

      if (result.persistedForRetry) {
        setSyncStatusMessage("Heartbeat hit a network error and was saved for retry.");
      } else {
        setSyncStatusMessage(`Heartbeat accepted at ${result.response.lastHeartbeatAt}.`);
      }

      await refreshOutbox();
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
  }, [auth.accessToken, baseUrl, refreshOutbox, room]);

  const fetchSyncHealth = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    setSyncStatusMessage(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { syncStatus: nextSyncHealth } = await client.getSyncHealth(room.id);
      setSyncHealth(nextSyncHealth);
      setSyncStatusMessage(`Fetched sync health at ${nextSyncHealth.evaluatedAt}.`);
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
  }, [auth.accessToken, baseUrl, room]);

  const processOutboxAction = useCallback(async () => {
    if (!auth.accessToken) return;
    setBusy(true);
    setApiError(undefined);
    setSyncStatusMessage(undefined);
    try {
      const operations = await listOutbox();
      if (operations.length === 0) {
        setOutbox([]);
        setSyncStatusMessage("Outbox is empty.");
        return;
      }

      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      let processedCount = 0;
      let failedMessage: string | undefined;
      let failedLabel: string | undefined;
      const touchedRoomIds = new Set<string>();

      for (const operation of operations) {
        try {
          const result = await processOutboxOperation(client, operation);
          await dequeueOutbox(operation.id);
          processedCount += 1;
          touchedRoomIds.add(result.roomId);
        } catch (err) {
          failedLabel = describeOutboxOperation(operation);
          failedMessage =
            err instanceof ApiError
              ? `${err.status} ${err.message}`
              : err instanceof Error
                ? err.message
                : "Unknown error";
          await enqueueOutbox({ ...operation, attempts: operation.attempts + 1 });
          break;
        }
      }

      const nextOutbox = await listOutbox();
      setOutbox(nextOutbox);

      if (room && touchedRoomIds.has(room.id)) {
        try {
          const { syncStatus: nextSyncHealth } = await client.getSyncHealth(room.id);
          setSyncHealth(nextSyncHealth);
        } catch {
          /* keep successful outbox processing from being treated as failed */
        }
      }

      if (failedMessage) {
        setSyncStatusMessage(
          processedCount > 0
            ? `Processed ${processedCount} outbox item(s); stopped on ${failedLabel}: ${failedMessage}.`
            : `Outbox processing failed on ${failedLabel}: ${failedMessage}.`
        );
      } else {
        setSyncStatusMessage(`Processed ${processedCount} outbox item(s).`);
      }
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
  }, [auth.accessToken, baseUrl, room]);

  const fetchTaskBoard = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      setTaskBoard(await client.getTaskBoard(room.id));
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

  const postProtocolNote = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const course = room.course;
      const checkpointId = course?.checkpoints?.[0]?.id ?? "cp-smoke-1";
      const { protocolNote } = await client.postProtocolNote(room.id, {
        checkpointId,
        category: "nutrition",
        body: "Smoke: electrolytes + gel at CP1"
      });
      setLastProtocolNote(protocolNote);
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

  const fetchTimeline = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { events } = await client.getTimeline(room.id);
      setTimeline(events);
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
          <Text style={styles.subtitle}>Chunk D2 mobile sync smoke test</Text>

          <Text style={styles.label}>API base</Text>
          <Text style={styles.code}>{baseUrl}</Text>

          <Text style={styles.label}>Redirect URI</Text>
          <Text style={styles.code}>{auth.redirectUri}</Text>

          <Text style={styles.label}>Auth status</Text>
          <Text style={styles.value}>{auth.status}</Text>

          <Text style={styles.label}>Outbox count</Text>
          <Text style={styles.code}>{outbox.length}</Text>

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
                <Pressable style={styles.secondaryButton} onPress={processOutboxAction} disabled={busy}>
                  <Text style={styles.secondaryButtonLabel}>
                    {busy ? "Processing..." : "Process Outbox"}
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
                    {room.entitlement.status === "paid" && room.status === "draft" ? (
                      <Pressable style={styles.primaryButton} onPress={activateRoom} disabled={busy}>
                        <Text style={styles.primaryButtonLabel}>
                          {busy ? "Calling API..." : "Activate room (staging)"}
                        </Text>
                      </Pressable>
                    ) : null}
                    {room.status === "active" ? (
                      <>
                        <Pressable style={styles.primaryButton} onPress={sendPing} disabled={busy}>
                          <Text style={styles.primaryButtonLabel}>
                            {busy ? "Sending..." : "Send ping (staging)"}
                          </Text>
                        </Pressable>
                        <Pressable style={styles.primaryButton} onPress={postSyncHeartbeat} disabled={busy}>
                          <Text style={styles.primaryButtonLabel}>
                            {busy ? "Sending..." : "POST sync heartbeat"}
                          </Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={fetchSyncHealth} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>GET sync health</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={fetchProjection} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Fetch projection (GET)</Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.secondaryButton,
                            projectionPollEnabled ? styles.secondaryButtonActive : null
                          ]}
                          onPress={() => setProjectionPollEnabled((v) => !v)}
                          disabled={busy}
                        >
                          <Text style={styles.secondaryButtonLabel}>
                            {projectionPollEnabled
                              ? "Auto-refresh projection: ON (8s)"
                              : "Auto-refresh projection: OFF"}
                          </Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={fetchTaskBoard} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Fetch task board (GET)</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={postProtocolNote} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Post protocol note (staging)</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={fetchTimeline} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Fetch ops timeline (GET)</Text>
                        </Pressable>
                      </>
                    ) : null}
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

          {syncStatusMessage ? (
            <>
              <Text style={styles.label}>Sync status</Text>
              <Text style={styles.body}>{syncStatusMessage}</Text>
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

          {lastPing ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>Last ping</Text>
              {lastPing.decision === "accepted" ? (
                <>
                  <Text style={styles.body}>Decision</Text>
                  <Text style={[styles.code, { color: "#86efac" }]}>accepted</Text>
                  <Text style={styles.body}>Ping ID</Text>
                  <Text style={styles.code}>{lastPing.pingId}</Text>
                  <Text style={styles.body}>Recorded at</Text>
                  <Text style={styles.code}>{lastPing.recordedAt}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.body}>Decision</Text>
                  <Text style={styles.errorText}>rejected — {lastPing.reason}</Text>
                  <Text style={styles.body}>Message</Text>
                  <Text style={styles.errorText}>{lastPing.message}</Text>
                </>
              )}
            </View>
          ) : null}

          {outbox.length > 0 ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Queued outbox</Text>
              <Text style={styles.body}>Count</Text>
              <Text style={styles.code}>{outbox.length}</Text>
              <Text style={styles.body}>Next item</Text>
              <Text style={styles.code}>
                {describeOutboxOperation(outbox[0]!)} (attempts: {outbox[0]!.attempts})
              </Text>
            </View>
          ) : null}

          {syncHealth ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>WS5 sync health</Text>
              <Text style={styles.body}>Tracked devices</Text>
              <Text style={styles.code}>{syncHealth.devices.length}</Text>
              <Text style={styles.body}>Total pending</Text>
              <Text style={styles.code}>{syncHealth.totalPendingAcrossDevices}</Text>
              <Text style={styles.body}>Stale devices</Text>
              <Text style={styles.code}>{syncHealth.devices.filter((device) => device.isStale).length}</Text>
              <Text style={styles.body}>Evaluated at</Text>
              <Text style={styles.code}>{syncHealth.evaluatedAt}</Text>
            </View>
          ) : null}

          {projection ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>GET /race-rooms/:id/projection</Text>
              <Text style={styles.body}>Confidence</Text>
              <Text style={[styles.code, { color: projection.projectionConfidence === "fresh" ? "#86efac" : "#fde68a" }]}>
                {projection.projectionConfidence}
              </Text>
              <Text style={styles.body}>Progress</Text>
              <Text style={styles.code}>{Math.round(projection.progressMeters)} m</Text>
              <Text style={styles.body}>ETA finish</Text>
              <Text style={styles.code}>{projection.etaFinishPlanIso}</Text>
              <Text style={styles.body}>Staleness (s since last ping)</Text>
              <Text style={styles.code}>{Math.round(projection.secondsSinceLastAcceptedPing)} s</Text>
              {projectionPolledAt ? (
                <>
                  <Text style={styles.body}>Last projection fetch</Text>
                  <Text style={styles.code}>{projectionPolledAt}</Text>
                </>
              ) : null}
              {projection.weatherStub ? (
                <>
                  <Text style={styles.body}>Weather stub</Text>
                  <Text style={styles.code}>{projection.weatherStub.summary}</Text>
                  <Text style={styles.body}>Assumed headwind (m/s)</Text>
                  <Text style={styles.code}>{String(projection.weatherStub.assumedHeadwindMps)}</Text>
                </>
              ) : null}
            </View>
          ) : null}

          {lastProtocolNote ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>POST /race-rooms/:id/protocol-notes</Text>
              <Text style={styles.body}>Note ID</Text>
              <Text style={styles.code}>{lastProtocolNote.id}</Text>
              <Text style={styles.body}>Category / checkpoint</Text>
              <Text style={styles.code}>
                {lastProtocolNote.category} @ {lastProtocolNote.checkpointId}
              </Text>
              <Text style={styles.body}>Body</Text>
              <Text style={styles.code}>{lastProtocolNote.body}</Text>
            </View>
          ) : null}

          {timeline !== undefined ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>GET /race-rooms/:id/timeline</Text>
              <Text style={styles.body}>Events</Text>
              <Text style={styles.code}>{timeline.length} total</Text>
              {timeline.length === 0 ? (
                <Text style={[styles.code, { color: "#6b7280" }]}>— no events yet —</Text>
              ) : (
                [...timeline].reverse().slice(0, 4).map((e) => (
                  <Text key={e.id} style={styles.code}>
                    {e.kind}: {e.message}
                  </Text>
                ))
              )}
            </View>
          ) : null}

          {taskBoard ? (
            <View style={{ marginTop: 16 }}>
              <Text style={styles.label}>GET /race-rooms/:id/tasks</Text>
              <Text style={styles.body}>Tasks</Text>
              <Text style={styles.code}>{taskBoard.tasks.length} total</Text>
              {taskBoard.tasks.length === 0 ? (
                <Text style={[styles.code, { color: "#6b7280" }]}>— no tasks on board —</Text>
              ) : (
                taskBoard.tasks.slice(0, 3).map((t) => (
                  <Text key={t.id} style={styles.code}>
                    [{t.status}] {t.title}
                  </Text>
                ))
              )}
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
  },
  secondaryButtonActive: {
    borderWidth: 2,
    borderColor: "#3b82f6"
  },
  summaryCard: {
    marginTop: 16,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#1f2937"
  },
  summaryTitle: {
    color: "#f9fafb",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4
  }
});
