import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import {
  AppState,
  SafeAreaView,
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
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomProjection,
  Recommendation,
  SyncStatus
} from "@crewcue/contracts";
import { loadMobileConfig } from "./src/config";
import { useAuth } from "./src/auth/useAuth";
import { canMutateCheckpointStoppage, canMutateTaskBoard, getCurrentRoomRole } from "./src/auth/roleGuards";
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
import { crewCueLinking } from "./src/navigation/linking";
import { crewCueNavigationTheme } from "./src/navigation/navigationTheme";
import { GuestStack } from "./src/navigation/GuestStack";
import { CrewMainTabs } from "./src/navigation/CrewMainTabs";
import { AuthedShellProvider, type AuthedShellContextValue } from "./src/shell/AuthedShellContext";

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

  const shellValue: AuthedShellContextValue = {
    styles,
    baseUrl,
    auth,
    appState,
    pendingOutboxCount,
    outbox,
    outboxAutoProcessIntervalMs: OUTBOX_AUTO_PROCESS_INTERVAL_MS,
    apiError,
    syncStatusMessage,
    projection,
    room,
    roomDetail,
    lastPing,
    syncHealth,
    projectionPolledAt,
    lastProtocolNote,
    timeline,
    incidents,
    latestRecommendation,
    latestExplainability,
    planDelta,
    taskBoard,
    busy,
    outboxProcessing,
    projectionPollEnabled,
    canEditCheckpointStops,
    canUseCheckpointControls,
    canEditTasks,
    currentRoomRole,
    stationArrivalAt,
    describeOutboxOperation,
    describeOutboxStatus,
    onCreateRoom: createRoom,
    onProcessOutbox: processOutboxAction,
    onMarkEntitlementPaid: markEntitlementPaid,
    onFetchRoomDetails: fetchRoomDetails,
    onActivateRoom: activateRoom,
    onSendPing: sendPing,
    onPostSyncHeartbeat: postSyncHeartbeat,
    onFetchSyncHealth: fetchSyncHealth,
    onFetchProjection: fetchProjection,
    onToggleProjectionPoll: () => {
      setProjectionPollEnabled((v) => !v);
    },
    onFetchTaskBoard: fetchTaskBoard,
    onPostProtocolNote: postProtocolNote,
    onFetchTimeline: fetchTimeline,
    onPostIncident: postIncident,
    onFetchIncidents: fetchIncidents,
    onGenerateRecommendation: generateRecommendation,
    onAcceptRecommendation: () => {
      void decideRecommendation("accept");
    },
    onRejectRecommendation: () => {
      void decideRecommendation("reject");
    },
    onRecordStationArrival: (checkpointId) => {
      setStationArrivalAt((prev) => ({
        ...prev,
        [checkpointId]: new Date().toISOString()
      }));
    },
    onEnqueueManualStop: (checkpointId, arrivalAt) => {
      void enqueueManualStop(checkpointId, arrivalAt, new Date().toISOString());
    },
    onSignOut: auth.signOut,
    onToggleResolvedSource: enqueueSourceToggle,
    onEnqueueTaskAction: enqueueTaskAction
  };

  return (
    <AuthedShellProvider value={shellValue}>
      <NavigationContainer theme={crewCueNavigationTheme} linking={crewCueLinking}>
        {auth.status === "authenticated" ? <CrewMainTabs /> : <GuestStack />}
      </NavigationContainer>
      <StatusBar style="light" />
    </AuthedShellProvider>
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
