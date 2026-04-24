import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  AppState,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AppStateStatus
} from "react-native";
import type {
  AthletePingAcceptedResponse,
  AthletePingRejectedResponse,
  CheckpointPlan,
  CheckpointVisitSource,
  CrewAssignment,
  CrewTask,
  ExplainabilityRecord,
  IncidentEvent,
  PlanDelta,
  Role,
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  Recommendation,
  SyncStatus
} from "@crewcue/contracts";
import { loadMobileConfig } from "./src/config";
import { useAuth } from "./src/auth/useAuth";
import { ApiError, createApiClient } from "./src/api/client";
import { postSyncHeartbeatWithRetry } from "./src/sync/pendingHeartbeat";
import {
  list as listOutbox,
  replace as replaceOutbox,
  enqueue as enqueueOutbox,
  type OutboxOperation
} from "./src/sync/outboxStore";
import {
  countPendingOutboxOperations,
  describeOutboxOperation,
  processOutboxBatch
} from "./src/sync/outboxProcessor";
import { OperationalSummarySections } from "./src/components/OperationalSummarySections";
import { OperationalStatusRail } from "./src/components/OperationalStatusRail";
import { OutboxQueueInspector } from "./src/components/OutboxQueueInspector";

const MOBILE_SMOKE_DEVICE_ID = "mobile-smoke-device";
const DEFAULT_PENDING_QUEUE_COUNT = 1;
const OUTBOX_AUTO_PROCESS_INTERVAL_MS = 8000;

function describeOutboxStatus(status: OutboxOperation["status"]): string {
  if (status === "sent") {
    return "Sent";
  }

  if (status === "rejected") {
    return "Rejected";
  }

  if (status === "conflict") {
    return "Conflict";
  }

  return "Pending";
}

function canMutateCheckpointStoppage(auth: ReturnType<typeof useAuth>): boolean {
  if (auth.status !== "authenticated" || !auth.claims?.sub) {
    return false;
  }
  const roles = auth.claims.roomRoles;
  if (!roles || typeof roles !== "object") {
    return false;
  }
  const allowed = ["crew_member", "crew_chief", "team_manager"];
  return Object.values(roles).some((role) => typeof role === "string" && allowed.includes(role));
}

function getCurrentRoomRole(auth: ReturnType<typeof useAuth>, roomId?: string): Role | undefined {
  if (!roomId || auth.status !== "authenticated") {
    return undefined;
  }
  const role = auth.claims?.roomRoles?.[roomId];
  if (role === "athlete" || role === "crew_member" || role === "crew_chief" || role === "team_manager") {
    return role;
  }
  return undefined;
}

function canMutateTaskBoard(auth: ReturnType<typeof useAuth>, roomId?: string): boolean {
  const role = getCurrentRoomRole(auth, roomId);
  return role === "crew_member" || role === "crew_chief" || role === "team_manager";
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
  const [incidents, setIncidents] = useState<IncidentEvent[] | undefined>(undefined);
  const [latestRecommendation, setLatestRecommendation] = useState<Recommendation | undefined>(undefined);
  const [latestExplainability, setLatestExplainability] = useState<ExplainabilityRecord | null | undefined>(undefined);
  const [planDelta, setPlanDelta] = useState<PlanDelta | null | undefined>(undefined);
  const [syncHealth, setSyncHealth] = useState<SyncStatus | undefined>(undefined);
  const [outbox, setOutbox] = useState<OutboxOperation[]>([]);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | undefined>(undefined);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [outboxProcessing, setOutboxProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  const [stationArrivalAt, setStationArrivalAt] = useState<Record<string, string>>({});
  const outboxProcessingRef = useRef(false);
  const pendingOutboxCount = useMemo(() => countPendingOutboxOperations(outbox), [outbox]);
  const canEditCheckpointStops = useMemo(() => canMutateCheckpointStoppage(auth), [auth]);
  const currentRoomRole = useMemo(() => getCurrentRoomRole(auth, room?.id), [auth, room?.id]);
  const canEditTasks = useMemo(() => canMutateTaskBoard(auth, room?.id), [auth, room?.id]);
  const canUseCheckpointControls = Boolean(
    room?.status === "active" && projection && canEditCheckpointStops && !busy
  );

  const setStatusSuccess = useCallback((message: string) => {
    setApiError(undefined);
    setSyncStatusMessage(message);
  }, []);

  const setStatusError = useCallback((err: unknown) => {
    if (err instanceof ApiError) {
      setApiError(`${err.status} ${err.message}`);
    } else if (err instanceof Error) {
      setApiError(err.message);
    } else {
      setApiError("Unknown error");
    }
  }, []);

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

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => {
      subscription.remove();
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
        creatorRole: "team_manager"
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
      setIncidents(undefined);
      setLatestRecommendation(undefined);
      setLatestExplainability(undefined);
      setPlanDelta(undefined);
      setSyncHealth(undefined);
      setSyncStatusMessage(undefined);
      setStatusSuccess(`Room created (${created.id.slice(0, 8)}...)`);
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, auth.claims, baseUrl, setStatusError, setStatusSuccess]);

  const markEntitlementPaid = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const entitlement = await client.updateEntitlement(room.id, "paid");
      setRoom((r) => (r ? { ...r, entitlement } : r));
      setStatusSuccess("Entitlement updated to paid.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const activateRoom = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const eventEndsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
      const activated = await client.activateRaceRoom(room.id, { eventEndsAt });
      setRoom(activated);
      setStatusSuccess("Room activated.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

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
      setStatusSuccess("Ping submitted.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const fetchProjection = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      setProjection(await client.getProjection(room.id));
      setProjectionPolledAt(new Date().toISOString());
      setStatusSuccess("Projection fetched.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

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
        setStatusSuccess("Heartbeat hit a network error and was saved for retry.");
      } else {
        setStatusSuccess(`Heartbeat accepted at ${result.response.lastHeartbeatAt}.`);
      }

      await refreshOutbox();
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, baseUrl, refreshOutbox, room, setStatusError, setStatusSuccess]);

  const fetchSyncHealth = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    setSyncStatusMessage(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { syncStatus: nextSyncHealth } = await client.getSyncHealth(room.id);
      setSyncHealth(nextSyncHealth);
      setStatusSuccess(`Fetched sync health at ${nextSyncHealth.evaluatedAt}.`);
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, baseUrl, room, setStatusError, setStatusSuccess]);

  const runOutboxProcessing = useCallback(
    async (mode: "auto" | "manual") => {
      if (!auth.accessToken || outboxProcessingRef.current) return;

      outboxProcessingRef.current = true;
      setOutboxProcessing(true);
      if (mode === "manual") {
        setApiError(undefined);
        setSyncStatusMessage(undefined);
      }

      try {
        const operations = await listOutbox();
        if (operations.length === 0) {
          setOutbox([]);
          if (mode === "manual") {
            setSyncStatusMessage("Outbox is empty.");
          }
          return;
        }

        const pendingCount = countPendingOutboxOperations(operations);
        if (pendingCount === 0) {
          setOutbox(operations);
          if (mode === "manual") {
            setSyncStatusMessage("No pending outbox items.");
          }
          return;
        }

        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const result = await processOutboxBatch(client, operations);
        await replaceOutbox(result.operations);
        setOutbox(result.operations);

        if (room && result.touchedRoomIds.includes(room.id)) {
          try {
            const { syncStatus: nextSyncHealth } = await client.getSyncHealth(room.id);
            setSyncHealth(nextSyncHealth);
          } catch {
            /* keep successful outbox processing from being treated as failed */
          }
        }

        const remainingPendingCount = countPendingOutboxOperations(result.operations);
        if (result.operatorSignal) {
          const prefix =
            result.processedCount > 0
              ? `Processed ${result.processedCount} outbox item(s). `
              : mode === "auto"
                ? "Auto-processed outbox. "
                : "";
          setSyncStatusMessage(
            `${prefix}${describeOutboxStatus(result.operatorSignal.status)}: ${result.operatorSignal.label} — ${result.operatorSignal.feedback}${
              remainingPendingCount > 0 ? ` (${remainingPendingCount} pending)` : ""
            }`
          );
        } else if (mode === "manual") {
          setSyncStatusMessage(
            `Processed ${result.processedCount} outbox item(s).${
              remainingPendingCount > 0 ? ` ${remainingPendingCount} pending.` : ""
            }`
          );
        }
      } catch (err) {
        if (mode === "manual") {
          if (err instanceof ApiError) {
            setApiError(`${err.status} ${err.message}`);
          } else if (err instanceof Error) {
            setApiError(err.message);
          } else {
            setApiError("Unknown error");
          }
        }
      } finally {
        outboxProcessingRef.current = false;
        setOutboxProcessing(false);
      }
    },
    [auth.accessToken, baseUrl, room]
  );

  const processOutboxAction = useCallback(async () => {
    await runOutboxProcessing("manual");
  }, [runOutboxProcessing]);

  useEffect(() => {
    if (
      auth.status !== "authenticated" ||
      !auth.accessToken ||
      room?.status !== "active" ||
      appState !== "active" ||
      pendingOutboxCount === 0
    ) {
      return;
    }

    void runOutboxProcessing("auto");
    const id = setInterval(() => {
      void runOutboxProcessing("auto");
    }, OUTBOX_AUTO_PROCESS_INTERVAL_MS);

    return () => clearInterval(id);
  }, [
    appState,
    auth.accessToken,
    auth.status,
    pendingOutboxCount,
    room?.id,
    room?.status,
    runOutboxProcessing
  ]);

  const fetchTaskBoard = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      setTaskBoard(await client.getTaskBoard(room.id));
      setStatusSuccess("Task board fetched.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

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
      setStatusSuccess("Protocol note posted.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const fetchTimeline = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { events } = await client.getTimeline(room.id);
      setTimeline(events);
      setStatusSuccess("Timeline fetched.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const postIncident = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const checkpointId = room.course?.checkpoints?.[0]?.id;
      const { incident } = await client.postIncident(room.id, {
        category: "fuel",
        severity: "medium",
        checkpointId,
        summary: "Fueling behind planned intake",
        details: "WS4 smoke flow from mobile shell"
      });
      setIncidents((prev) => [...(prev ?? []), incident]);
      setStatusSuccess("Incident posted.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const fetchIncidents = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { incidents: nextIncidents } = await client.getIncidents(room.id);
      setIncidents(nextIncidents);
      setStatusSuccess(`Fetched incidents (${nextIncidents.length}).`);
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const generateRecommendation = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    const latestIncident = incidents?.[incidents.length - 1];
    if (!latestIncident) {
      setSyncStatusMessage("Post or fetch incidents first.");
      return;
    }
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { recommendation, explainability } = await client.generateRecommendation(room.id, latestIncident.id);
      setLatestRecommendation(recommendation);
      setLatestExplainability(explainability);
      setStatusSuccess("Recommendation generated.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, incidents, baseUrl, setStatusError, setStatusSuccess]);

  const decideRecommendation = useCallback(
    async (decision: "accept" | "reject") => {
      if (!auth.accessToken || !room || !latestRecommendation) return;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const result =
          decision === "accept"
            ? await client.acceptRecommendation(room.id, latestRecommendation.id)
            : await client.rejectRecommendation(room.id, latestRecommendation.id);
        setLatestRecommendation(result.recommendation);
        if (decision === "accept") {
          const { planDelta: nextPlanDelta } = await client.getPlanDelta(room.id);
          setPlanDelta(nextPlanDelta);
        }
        setStatusSuccess(`Recommendation ${decision}ed.`);
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, room, latestRecommendation, baseUrl, setStatusError, setStatusSuccess]
  );

  const fetchRoomDetails = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const detail = await client.getRaceRoom(room.id);
      setRoomDetail(detail);
      setRoom(detail.room);
      setStatusSuccess("Room details fetched.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const enqueueManualStop = useCallback(
    async (checkpointId: string, arrivalAt: string, departureAt: string) => {
      if (!room) return;
      await enqueueOutbox({
        id: `manual-stop-${room.id}-${checkpointId}-${Date.now()}`,
        type: "checkpoint",
        payload: { roomId: room.id, checkpointId, action: "manual_stop", arrivalAt, departureAt },
        attempts: 0,
        status: "pending"
      });
      setStationArrivalAt((prev) => {
        const next = { ...prev };
        delete next[checkpointId];
        return next;
      });
      await refreshOutbox();
    },
    [room, refreshOutbox]
  );

  const enqueueSourceToggle = useCallback(
    async (checkpointId: string, visitIndex: number, resolvedSource: CheckpointVisitSource) => {
      if (!room) return;
      await enqueueOutbox({
        id: `source-toggle-${room.id}-${checkpointId}-${visitIndex}-${Date.now()}`,
        type: "checkpoint",
        payload: { roomId: room.id, checkpointId, action: "set_resolved_source", visitIndex, resolvedSource },
        attempts: 0,
        status: "pending"
      });
      await refreshOutbox();
    },
    [room, refreshOutbox]
  );

  const enqueueTaskAction = useCallback(
    async (action: "assign" | "start" | "complete", task: CrewTask) => {
      if (!room || !auth.claims?.sub) return;
      if (room.status !== "active") {
        setSyncStatusMessage("Task actions require an active room.");
        return;
      }
      if (!canEditTasks) {
        setSyncStatusMessage("Task actions require crew role access.");
        return;
      }

      if (action === "assign") {
        const assigneeRole = currentRoomRole ?? "crew_member";
        await enqueueOutbox({
          id: `task-assign-${room.id}-${task.id}-${Date.now()}`,
          type: "task",
          payload: {
            roomId: room.id,
            taskId: task.id,
            action: "assign",
            assigneeUserId: auth.claims.sub,
            assigneeRole
          },
          attempts: 0,
          status: "pending"
        });
      } else if (action === "start") {
        await enqueueOutbox({
          id: `task-start-${room.id}-${task.id}-${Date.now()}`,
          type: "task",
          payload: { roomId: room.id, taskId: task.id, action: "start" },
          attempts: 0,
          status: "pending"
        });
      } else {
        await enqueueOutbox({
          id: `task-complete-${room.id}-${task.id}-${Date.now()}`,
          type: "task",
          payload: { roomId: room.id, taskId: task.id, action: "complete" },
          attempts: 0,
          status: "pending"
        });
      }

      await refreshOutbox();
      setSyncStatusMessage(`Queued task ${action} for "${task.title}".`);
    },
    [room, auth.claims?.sub, canEditTasks, currentRoomRole, refreshOutbox]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>CrewCue</Text>
          <Text style={styles.subtitle}>Crew operations</Text>

          <Text style={styles.label}>API base</Text>
          <Text style={styles.code}>{baseUrl}</Text>

          <Text style={styles.label}>Redirect URI</Text>
          <Text style={styles.code}>{auth.redirectUri}</Text>

          <Text style={styles.label}>Auth status</Text>
          <Text style={styles.value}>{auth.status}</Text>

          <Text style={styles.label}>Outbox count</Text>
          <Text style={styles.code}>
            {pendingOutboxCount} pending / {outbox.length} total
          </Text>

          <Text style={styles.label}>App state</Text>
          <Text style={styles.code}>{appState}</Text>

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

          {auth.status === "authenticated" ? (
            <OperationalStatusRail
              styles={styles}
              pendingOutboxCount={pendingOutboxCount}
              lastError={apiError}
              lastStatusMessage={syncStatusMessage}
              projectionStaleSeconds={projection?.secondsSinceLastAcceptedPing}
            />
          ) : null}

          {auth.status === "authenticated" ? (
            <OutboxQueueInspector
              styles={styles}
              outbox={outbox}
              outboxAutoProcessIntervalMs={OUTBOX_AUTO_PROCESS_INTERVAL_MS}
              describeOutboxOperation={describeOutboxOperation}
              describeOutboxStatus={describeOutboxStatus}
            />
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
                <Pressable
                  style={styles.secondaryButton}
                  onPress={processOutboxAction}
                  disabled={busy || outboxProcessing}
                >
                  <Text style={styles.secondaryButtonLabel}>
                    {outboxProcessing ? "Processing..." : "Process Outbox"}
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
                        <Pressable style={styles.secondaryButton} onPress={postIncident} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Post incident (WS4)</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButton} onPress={fetchIncidents} disabled={busy}>
                          <Text style={styles.secondaryButtonLabel}>Fetch incidents (GET)</Text>
                        </Pressable>
                        <Pressable
                          style={styles.secondaryButton}
                          onPress={generateRecommendation}
                          disabled={busy || !incidents || incidents.length === 0}
                        >
                          <Text style={styles.secondaryButtonLabel}>Generate recommendation</Text>
                        </Pressable>
                        <Pressable
                          style={styles.secondaryButton}
                          onPress={() => {
                            void decideRecommendation("accept");
                          }}
                          disabled={busy || latestRecommendation?.status !== "pending"}
                        >
                          <Text style={styles.secondaryButtonLabel}>Accept recommendation</Text>
                        </Pressable>
                        <Pressable
                          style={styles.secondaryButton}
                          onPress={() => {
                            void decideRecommendation("reject");
                          }}
                          disabled={busy || latestRecommendation?.status !== "pending"}
                        >
                          <Text style={styles.secondaryButtonLabel}>Reject recommendation</Text>
                        </Pressable>
                        {room.course?.checkpoints && room.course.checkpoints.length > 0 ? (
                          <>
                            <Text style={[styles.label, { marginTop: 8 }]}>Checkpoint stations</Text>
                            {!projection ? (
                              <Text style={styles.body}>
                                Fetch projection first, then station controls will unlock.
                              </Text>
                            ) : null}
                            {!canEditCheckpointStops ? (
                              <Text style={styles.body}>
                                Station timing controls require crew role access (crew_member, crew_chief, or team_manager).
                              </Text>
                            ) : null}
                            {room.course.checkpoints.map((cp) => {
                              const arrival = stationArrivalAt[cp.id];
                              return (
                                <View key={cp.id} style={{ gap: 4 }}>
                                  <Text style={styles.body}>
                                    {cp.id}
                                    {cp.plannedStopSeconds ? ` · ${cp.plannedStopSeconds}s planned` : ""}
                                  </Text>
                                  {arrival ? (
                                    <>
                                      <Text style={[styles.code, { color: "#86efac" }]}>
                                        At station since {arrival.slice(11, 19)}Z
                                      </Text>
                                      <Pressable
                                        style={styles.primaryButton}
                                        disabled={!canUseCheckpointControls}
                                        onPress={() => {
                                          void enqueueManualStop(cp.id, arrival, new Date().toISOString());
                                        }}
                                      >
                                        <Text style={styles.primaryButtonLabel}>Exit station → enqueue stop</Text>
                                      </Pressable>
                                    </>
                                  ) : (
                                    <Pressable
                                      style={styles.secondaryButton}
                                      disabled={!canUseCheckpointControls}
                                      onPress={() => {
                                        setStationArrivalAt((prev) => ({
                                          ...prev,
                                          [cp.id]: new Date().toISOString()
                                        }));
                                      }}
                                    >
                                      <Text style={styles.secondaryButtonLabel}>Enter station</Text>
                                    </Pressable>
                                  )}
                                </View>
                              );
                            })}
                          </>
                        ) : null}
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

          <OperationalSummarySections
            styles={styles}
            room={room}
            roomDetail={roomDetail}
            lastPing={lastPing}
            syncHealth={syncHealth}
            projection={projection}
            projectionPolledAt={projectionPolledAt}
            lastProtocolNote={lastProtocolNote}
            timeline={timeline}
            incidents={incidents}
            latestRecommendation={latestRecommendation}
            latestExplainability={latestExplainability}
            planDelta={planDelta}
            taskBoard={taskBoard}
            onToggleResolvedSource={enqueueSourceToggle}
            canToggleResolvedSource={canUseCheckpointControls}
            onEnqueueTaskAction={enqueueTaskAction}
            canMutateTasks={Boolean(room?.status === "active" && canEditTasks && !busy)}
            taskAssigneeUserId={auth.claims?.sub}
            taskAssigneeRole={currentRoomRole}
          />
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
  },
  statusRail: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#0b1220",
    borderWidth: 1,
    borderColor: "#1f2937",
    gap: 4
  },
  statusRailTitle: {
    color: "#f9fafb",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  statusRailItem: {
    color: "#d1d5db",
    fontSize: 13
  },
  outboxItem: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    paddingTop: 12
  },
  outboxItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  outboxStatus: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  outboxStatusPending: {
    color: "#fde68a"
  },
  outboxStatusSent: {
    color: "#86efac"
  },
  outboxStatusRejected: {
    color: "#fca5a5"
  },
  outboxStatusConflict: {
    color: "#f59e0b"
  },
  stoppageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937"
  },
  visitRow: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: "#374151"
  },
  toggleButton: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "#374151",
    alignSelf: "flex-start"
  },
  toggleButtonLabel: {
    color: "#d1d5db",
    fontSize: 12
  }
});
