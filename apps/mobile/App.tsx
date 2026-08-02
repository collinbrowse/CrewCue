import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { StatusBar } from "expo-status-bar";
import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import {
  AppState,
  InteractionManager,
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
  MergeRecord,
  PlanDelta,
  OpsTimelineEvent,
  ProtocolNote,
  RaceRoom,
  RaceRoomInvite,
  RaceRoomProjection,
  Recommendation,
  SyncQueueDiagnostics,
  SyncStatus
} from "@crewcue/contracts";
import { loadMobileConfig } from "./src/config";
import { useAuth } from "./src/auth/useAuth";
import {
  canMutateCheckpointStoppage,
  canMutateTaskBoard,
  canRecordMergeTelemetry,
  getCurrentRoomRole
} from "./src/auth/roleGuards";
import * as Crypto from "expo-crypto";
import { mapApiError } from "@crewcue/platform-client";
import { ApiError, createApiClient } from "./src/api/client";
import { appActionRegistry, appNoticeBus } from "./src/platform/runtime";
import { postSyncHeartbeatWithRetry } from "./src/sync/pendingHeartbeat";
import {
  list as listOutbox,
  commitProcessedBatch,
  mutate as mutateOutbox,
  enqueue as enqueueOutbox,
  enqueueWithConflictKey,
  type OutboxOperation
} from "./src/sync/outboxStore";
import {
  countPendingOutboxOperations,
  describeOutboxOperation,
  processOutboxBatch
} from "./src/sync/outboxProcessor";
import {
  buildCrewCueLinking,
  navigationStateForAuthedDeepLink,
  pathFromCrewCueUrl
} from "./src/navigation/linking";
import {
  CANVAS_BACKGROUND_COLOR,
  DSDesignSystemProvider,
  useDSTheme,
  type DSThemeTokens
} from "./src/design-system";
import { useCrewCueNavigationTheme } from "./src/navigation/navigationTheme";
import { GuestStack } from "./src/navigation/GuestStack";
import { CrewMainTabs } from "./src/navigation/CrewMainTabs";
import { TransientNoticeHost } from "./src/platform/TransientNoticeHost";
import { AuthedShellProvider, type AuthedShellContextValue } from "./src/shell/AuthedShellContext";
import { RaceChatPrefetcher } from "./src/navigation/RaceChatPrefetcher";
import { runNativeDependencyPrewarm } from "./src/chat/nativeDependencyPrewarm";
import * as SecureStore from "./src/storage/secureStorage";
import {
  ONBOARDING_INTENT_KEY,
  ONBOARDING_JOIN_DRAFT_KEY,
  ONBOARDING_NOTIFICATIONS_REQUIRED_KEY,
  ONBOARDING_NOTIFICATIONS_SEEN_KEY,
  type OnboardingIntent,
  type OnboardingJoinDraft
} from "./src/navigation/onboardingState";

const MOBILE_DEVICE_ID = "mobile-operator-device";
const crewCueNavigationRef = createNavigationContainerRef();
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

  useEffect(() => {
    if (!configResult.ok) {
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      runNativeDependencyPrewarm();
    });
    return () => task.cancel();
  }, [configResult.ok]);

  if (!configResult.ok) {
    return (
      <SafeAreaView style={bootStyles.container}>
        <View style={bootStyles.card}>
          <Text style={bootStyles.title}>Configuration missing</Text>
          <Text style={bootStyles.body}>
            The mobile app cannot start because the following env vars are missing:
          </Text>
          {configResult.missing.map((name) => (
            <Text key={name} style={bootStyles.code}>
              {name}
            </Text>
          ))}
          <Text style={bootStyles.body}>
            Copy <Text style={bootStyles.code}>apps/mobile/.env.example</Text> to{" "}
            <Text style={bootStyles.code}>apps/mobile/.env</Text> and restart Expo.
          </Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  return (
    <DSDesignSystemProvider>
      <AuthedShell baseUrl={configResult.config.apiBaseUrl} auth0={configResult.config} />
    </DSDesignSystemProvider>
  );
}

type AuthedShellProps = {
  baseUrl: string;
  auth0: {
    auth0Domain: string;
    auth0ClientId: string;
    auth0Audience: string;
    auth0ConnectionGoogle: string;
    auth0ConnectionApple: string;
    auth0ConnectionEmail: string;
  };
};

type RaceProfile = {
  creatorName: string;
  raceName: string;
  raceDescription: string;
  crewName: string;
  setupComplete: boolean;
};

/** `/race-rooms/mine` can briefly return a snapshot that omits optional roster fields; keep client state from regressing. */
function mergeRaceRoomListSnapshot(prev: RaceRoom, fromList: RaceRoom): RaceRoom {
  const memberships = fromList.memberships.map((m) => {
    const p = prev.memberships.find((x) => x.userId === m.userId);
    const nextName = m.displayName?.trim();
    const prevName = p?.displayName?.trim();
    if (nextName) {
      return m;
    }
    if (prevName) {
      return { ...m, displayName: prevName };
    }
    return m;
  });
  const listCreator = fromList.creatorName?.trim();
  const prevCreator = prev.creatorName?.trim();
  return {
    ...fromList,
    creatorName: listCreator || prevCreator || fromList.creatorName,
    memberships
  };
}

function AuthedShell({ baseUrl, auth0 }: AuthedShellProps): ReactElement {
  const theme = useDSTheme();
  const navigationTheme = useCrewCueNavigationTheme();
  const styles = useMemo(() => createAuthedStyles(theme), [theme]);
  const auth = useAuth({
    domain: auth0.auth0Domain,
    clientId: auth0.auth0ClientId,
    audience: auth0.auth0Audience,
    connections: {
      google: auth0.auth0ConnectionGoogle,
      apple: auth0.auth0ConnectionApple,
      email: auth0.auth0ConnectionEmail
    }
  });

  const [room, setRoom] = useState<RaceRoom | undefined>(undefined);
  const [raceProfile, setRaceProfile] = useState<RaceProfile | undefined>(undefined);
  const profileStorageKey = useMemo(
    () => (room ? `crewcue.race-profile.${room.id}` : undefined),
    [room?.id]
  );

  useEffect(() => {
    if (!profileStorageKey) {
      setRaceProfile(undefined);
      return;
    }
    const storageKey = profileStorageKey;
    let cancelled = false;
    void (async () => {
      const raw = await SecureStore.getItemAsync(storageKey);
      if (cancelled) {
        return;
      }
      if (!raw) {
        setRaceProfile(undefined);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as RaceProfile;
        if (!cancelled) {
          setRaceProfile(parsed);
        }
      } catch {
        if (!cancelled) {
          setRaceProfile(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileStorageKey]);

  const [roomDetail, setRoomDetail] = useState<
    { room: RaceRoom; permissions: Record<string, boolean> } | undefined
  >(undefined);
  const [invites, setInvites] = useState<RaceRoomInvite[] | undefined>(undefined);
  const [myRaceRooms, setMyRaceRooms] = useState<RaceRoom[] | undefined>(undefined);
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
  const [queueDiagnostics, setQueueDiagnostics] = useState<SyncQueueDiagnostics[] | undefined>(undefined);
  const [mergeRecords, setMergeRecords] = useState<MergeRecord[] | undefined>(undefined);
  const [outbox, setOutbox] = useState<OutboxOperation[]>([]);
  const [syncStatusMessage, setSyncStatusMessage] = useState<string | undefined>(undefined);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [outboxProcessing, setOutboxProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);
  const [stationArrivalAt, setStationArrivalAt] = useState<Record<string, string>>({});
  const [onboardingIntent, setOnboardingIntent] = useState<OnboardingIntent>("none");
  const [onboardingJoinDraft, setOnboardingJoinDraft] = useState<OnboardingJoinDraft | undefined>(undefined);
  const [onboardingNotificationsSeen, setOnboardingNotificationsSeen] = useState(false);
  const [onboardingNotificationsRequired, setOnboardingNotificationsRequired] = useState(false);
  const outboxProcessingRef = useRef(false);
  const createRoomIdempotencyKeyRef = useRef<string | null>(null);
  const pendingOutboxCount = useMemo(() => countPendingOutboxOperations(outbox), [outbox]);
  const canEditCheckpointStops = useMemo(() => canMutateCheckpointStoppage(auth), [auth]);
  const currentRoomRole = useMemo(() => getCurrentRoomRole(auth, room?.id), [auth, room?.id]);
  const canEditTasks = useMemo(() => canMutateTaskBoard(auth, room?.id), [auth, room?.id]);
  const canUseCheckpointControls = Boolean(
    room?.status === "active" && projection && canEditCheckpointStops && !busy
  );
  const canLogMergeTelemetry = useMemo(() => canRecordMergeTelemetry(currentRoomRole), [currentRoomRole]);

  const setStatusSuccess = useCallback((message: string) => {
    setApiError(undefined);
    setSyncStatusMessage(message);
  }, []);

  const setStatusError = useCallback((err: unknown, fingerprint = "shell") => {
    const mapped = mapApiError(err);
    setApiError(mapped.message);
    appNoticeBus.presentTransient({
      catalogKey: mapped.key,
      fingerprint: `${fingerprint}:${mapped.key}`
    });
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

  const refreshOnboardingStage = useCallback(async () => {
    const storedIntent = (await SecureStore.getItemAsync(ONBOARDING_INTENT_KEY)) as OnboardingIntent | null;
    if (storedIntent === "signupAthlete" || storedIntent === "joinCrew" || storedIntent === "none") {
      setOnboardingIntent(storedIntent);
    } else {
      setOnboardingIntent("none");
    }
    const rawJoin = await SecureStore.getItemAsync(ONBOARDING_JOIN_DRAFT_KEY);
    if (rawJoin) {
      try {
        const parsed = JSON.parse(rawJoin) as OnboardingJoinDraft;
        if (parsed.roomCode && parsed.displayName) {
          setOnboardingJoinDraft(parsed);
        } else {
          setOnboardingJoinDraft(undefined);
        }
      } catch {
        setOnboardingJoinDraft(undefined);
      }
    } else {
      setOnboardingJoinDraft(undefined);
    }
    setOnboardingNotificationsSeen((await SecureStore.getItemAsync(ONBOARDING_NOTIFICATIONS_SEEN_KEY)) === "true");
    setOnboardingNotificationsRequired((await SecureStore.getItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY)) === "true");
  }, []);

  useEffect(() => {
    void refreshOnboardingStage();
  }, [refreshOnboardingStage]);


  const pollProjectionQuiet = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    try {
      const token = auth.accessToken;
      const result = await appActionRegistry.run("shell:projection-quiet", "ignoreIfBusy", async () => {
        const client = createApiClient({ baseUrl, accessToken: token });
        setProjection(await client.getProjection(room.id));
        setProjectionPolledAt(new Date().toISOString());
      });
      if (result.status === "skipped") {
        return;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setProjection(undefined);
        setProjectionPolledAt(undefined);
      }
      /* background poll — avoid spamming apiError */
    }
  }, [auth.accessToken, room, baseUrl]);

  useEffect(() => {
    if (!projectionPollEnabled || !room?.id || !auth.accessToken) {
      return;
    }
    void pollProjectionQuiet();
    const id = setInterval(() => {
      void pollProjectionQuiet();
    }, 8000);
    return () => clearInterval(id);
  }, [projectionPollEnabled, room?.id, auth.accessToken, pollProjectionQuiet]);

  const fetchMyRaceRooms = useCallback(async () => {
    if (!auth.accessToken) return;
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { rooms } = await client.listMyRaceRooms();
      setMyRaceRooms((prevList) => {
        if (!prevList?.length) {
          return rooms;
        }
        return rooms.map((r) => {
          const older = prevList.find((x) => x.id === r.id);
          return older ? mergeRaceRoomListSnapshot(older, r) : r;
        });
      });
      setRoom((prev) => {
        if (rooms.length === 0) {
          return undefined;
        }
        if (!prev) {
          return rooms[0];
        }
        const stillExists = rooms.find((r) => r.id === prev.id) ?? rooms[0];
        if (stillExists.id !== prev.id) {
          return stillExists;
        }
        return mergeRaceRoomListSnapshot(prev, stillExists);
      });
    } catch (err) {
      setStatusError(err);
    }
  }, [auth.accessToken, baseUrl, setStatusError]);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      return;
    }
    void fetchMyRaceRooms();
  }, [auth.status, fetchMyRaceRooms]);

  const createRoom = useCallback(
    async (input?: { raceName?: string; creatorName?: string; raceDescription?: string; crewName?: string }) => {
    if (!auth.accessToken || !auth.claims?.sub) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const teamId = auth.claims.teamIds?.[0] ?? "mobile-ops-team";
      const createBody = {
        teamId,
        athleteId: auth.claims.sub,
        name: input?.raceName?.trim() || `Race ${new Date().toISOString().slice(0, 16)}`,
        creatorName: input?.creatorName?.trim() || "Race lead",
        description: input?.raceDescription?.trim() || undefined,
        crewName: input?.crewName?.trim() || undefined,
        creatorRole: "team_manager" as const
      };
      const idempotencyKey =
        createRoomIdempotencyKeyRef.current ??
        `create-room:${auth.claims.sub}:${Crypto.randomUUID()}`;
      createRoomIdempotencyKeyRef.current = idempotencyKey;
      const created = await client.createRaceRoom(createBody, { idempotencyKey });
      createRoomIdempotencyKeyRef.current = null;
      setRoom(created);
      setRoomDetail(undefined);
      setLastPing(undefined);
      setInvites(undefined);
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
      setQueueDiagnostics(undefined);
      setMergeRecords(undefined);
      setSyncStatusMessage(undefined);
      setMyRaceRooms((prev) => [created, ...(prev ?? []).filter((roomItem) => roomItem.id !== created.id)]);
      setStatusSuccess(`Room created (${created.id.slice(0, 8)}...)`);
      return created;
    } catch (err) {
      setStatusError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
    },
    [auth.accessToken, auth.claims, baseUrl, setStatusError, setStatusSuccess]
  );

  const saveRaceProfile = useCallback(
    async (profile: RaceProfile) => {
      setRaceProfile(profile);
      if (!profileStorageKey) {
        return;
      }
      await SecureStore.setItemAsync(profileStorageKey, JSON.stringify(profile));
    },
    [profileStorageKey]
  );

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
    try {
      const token = auth.accessToken;
      const result = await appActionRegistry.run("shell:fetch-projection", "ignoreIfBusy", async () => {
        setBusy(true);
        setApiError(undefined);
        try {
          const client = createApiClient({ baseUrl, accessToken: token });
          setProjection(await client.getProjection(room.id));
          setProjectionPolledAt(new Date().toISOString());
          setStatusSuccess("Projection fetched.");
        } finally {
          setBusy(false);
        }
      });
      if (result.status === "skipped") {
        return;
      }
    } catch (err) {
      setBusy(false);
      setStatusError(err);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]);

  const refreshProjectionQuiet = useCallback(() => {
    void pollProjectionQuiet();
  }, [pollProjectionQuiet]);

  const postSyncHeartbeat = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    setSyncStatusMessage(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const result = await postSyncHeartbeatWithRetry(client, {
        roomId: room.id,
        deviceId: MOBILE_DEVICE_ID,
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

  const refreshWs5Telemetry = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setBusy(true);
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const [health, diag, merges] = await Promise.all([
        client.getSyncHealth(room.id),
        client.getQueueDiagnostics(room.id, { limit: 25 }),
        client.getMergeRecords(room.id, { limit: 25 })
      ]);
      setSyncHealth(health.syncStatus);
      setQueueDiagnostics(diag.diagnostics);
      setMergeRecords(merges.mergeRecords);
      setStatusSuccess("WS5 telemetry refreshed.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, baseUrl, room, setStatusError, setStatusSuccess]);

  const pushQueueDiagnosticsSnapshot = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    if (room.status !== "active") {
      setSyncStatusMessage("Activate the room before pushing queue diagnostics.");
      return;
    }
    setBusy(true);
    setApiError(undefined);
    try {
      const operations = await listOutbox();
      const pendingByOpType: Record<string, number> = {};
      for (const op of operations) {
        if (op.status !== "pending") continue;
        pendingByOpType[op.type] = (pendingByOpType[op.type] ?? 0) + 1;
      }
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      await client.postQueueDiagnostics(room.id, {
        deviceId: MOBILE_DEVICE_ID,
        pendingByOpType
      });
      const { diagnostics } = await client.getQueueDiagnostics(room.id, { limit: 25 });
      setQueueDiagnostics(diagnostics);
      setStatusSuccess("Queue diagnostics snapshot pushed.");
    } catch (err) {
      setStatusError(err);
    } finally {
      setBusy(false);
    }
  }, [auth.accessToken, baseUrl, room, setStatusError, setStatusSuccess]);

  const recordOutboxMergeTelemetry = useCallback(
    async (operationId: string) => {
      if (!auth.accessToken || !room) return;
      if (room.status !== "active") {
        setSyncStatusMessage("Activate the room before logging merge telemetry.");
        return;
      }
      if (!canRecordMergeTelemetry(currentRoomRole)) {
        setSyncStatusMessage("Merge telemetry requires athlete, crew chief, or team manager role.");
        return;
      }
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        await client.postMergeRecord(room.id, {
          deviceId: MOBILE_DEVICE_ID,
          conflictKey: `outbox:${operationId}`,
          strategy: "manual",
          notes: "Conflict acknowledged from mobile outbox inspector"
        });
        const { mergeRecords: next } = await client.getMergeRecords(room.id, { limit: 25 });
        setMergeRecords(next);
        setStatusSuccess("Merge telemetry recorded.");
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, baseUrl, currentRoomRole, room, setStatusError, setStatusSuccess]
  );

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
        // Merge statuses into the live store so concurrent enqueues are not dropped.
        const committed = await commitProcessedBatch(operations, result.operations);
        setOutbox(committed);

        if (room && result.touchedRoomIds.includes(room.id)) {
          try {
            const { syncStatus: nextSyncHealth } = await client.getSyncHealth(room.id);
            setSyncHealth(nextSyncHealth);
          } catch {
            /* keep successful outbox processing from being treated as failed */
          }
        }

        const remainingPendingCount = countPendingOutboxOperations(committed);
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
          setStatusError(err);
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

  const retryOutboxOperationSafely = useCallback(
    async (operationId: string) => {
      const operations = await listOutbox();
      const target = operations.find((operation) => operation.id === operationId);
      if (!target) {
        setSyncStatusMessage("Outbox operation no longer exists.");
        return;
      }
      if (target.type !== "ping") {
        setSyncStatusMessage("Safe targeted retry currently supports ping/sync operations only.");
        return;
      }
      if (target.status === "sent") {
        setSyncStatusMessage("Outbox operation is already marked sent.");
        return;
      }

      const nextOperations = await mutateOutbox((current) =>
        current.map((operation) =>
          operation.id === operationId
            ? {
                ...operation,
                status: "pending" as const,
                feedback: "Operator requested safe retry.",
                updatedAt: new Date().toISOString()
              }
            : operation
        )
      );
      setOutbox(nextOperations);
      setSyncStatusMessage(`Queued safe retry for ${describeOutboxOperation(target)}.`);
      await runOutboxProcessing("manual");
    },
    [describeOutboxOperation, runOutboxProcessing]
  );

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
      const checkpointId = course?.checkpoints?.[0]?.id ?? "cp-ops-1";
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
        details: "Captured from mobile operations flow"
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

  const applyRaceRoomFromServer = useCallback((next: RaceRoom) => {
    setRoom(next);
    setRoomDetail((prev) =>
      prev?.room.id === next.id ? { room: next, permissions: prev.permissions } : prev
    );
    setMyRaceRooms((prev) => {
      if (!prev) {
        return [next];
      }
      const idx = prev.findIndex((r) => r.id === next.id);
      if (idx === -1) {
        return [next, ...prev];
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx]!, ...next };
      return copy;
    });
  }, []);

  const fetchRoomDetails = useCallback(
    async (explicitRoomId?: string) => {
      const roomId = explicitRoomId ?? room?.id;
      if (!auth.accessToken || !roomId) return;
      try {
        const token = auth.accessToken;
        const result = await appActionRegistry.run(`shell:fetch-room:${roomId}`, "ignoreIfBusy", async () => {
          setBusy(true);
          setApiError(undefined);
          try {
            const client = createApiClient({ baseUrl, accessToken: token });
            const detail = await client.getRaceRoom(roomId);
            setRoomDetail(detail);
            setRoom(detail.room);
            setMyRaceRooms((prev) => {
              if (!prev) {
                return [detail.room];
              }
              const idx = prev.findIndex((r) => r.id === detail.room.id);
              if (idx === -1) {
                return [detail.room, ...prev];
              }
              const copy = [...prev];
              copy[idx] = { ...copy[idx]!, ...detail.room };
              return copy;
            });
            setStatusSuccess("Room details fetched.");
          } finally {
            setBusy(false);
          }
        });
        if (result.status === "skipped") {
          return;
        }
      } catch (err) {
        setBusy(false);
        setStatusError(err);
      }
    },
    [auth.accessToken, room?.id, baseUrl, setStatusError, setStatusSuccess]
  );

  const fetchInvites = useCallback(async () => {
    if (!auth.accessToken || !room) return;
    setApiError(undefined);
    try {
      const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
      const { invites: nextInvites } = await client.getInvites(room.id);
      setInvites(nextInvites);
    } catch (err) {
      setStatusError(err);
    }
  }, [auth.accessToken, room, baseUrl, setStatusError]);

  const issueInvite = useCallback(
    async (input: { email: string; role: RaceRoomInvite["role"] }) => {
      if (!auth.accessToken || !room) return;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        await client.issueInvite(room.id, {
          email: input.email.trim().toLowerCase(),
          role: input.role
        });
        const [{ invites: nextInvites }, detail] = await Promise.all([client.getInvites(room.id), client.getRaceRoom(room.id)]);
        setInvites(nextInvites);
        setRoomDetail(detail);
        setRoom(detail.room);
        setStatusSuccess(`Invite sent to ${input.email.trim().toLowerCase()}.`);
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, room, baseUrl, setStatusError, setStatusSuccess]
  );

  const joinRoomByCode = useCallback(
    async (roomCode: string) => {
      if (!auth.accessToken) return false;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const joined = await client.joinRaceRoomByCode({ roomCode: roomCode.trim() });
        setRoom(joined.room);
        setRoomDetail({ room: joined.room, permissions: joined.permissions });
        const { invites: nextInvites } = await client.getInvites(joined.room.id);
        setInvites(nextInvites);
        await fetchMyRaceRooms();
        setStatusSuccess(
          joined.room.joinCode
            ? `Joined race: ${joined.room.name} (code ${joined.room.joinCode})`
            : `Joined race: ${joined.room.name}`
        );
        return true;
      } catch (err) {
        setStatusError(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, baseUrl, fetchMyRaceRooms, setStatusError, setStatusSuccess]
  );

  const updateMemberRole = useCallback(
    async (memberUserId: string, role: RaceRoomInvite["role"]) => {
      if (!auth.accessToken || !room) return;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const updated = await client.updateRaceRoomMemberRole(room.id, memberUserId, { role });
        setRoom(updated.room);
        setRoomDetail((prev) => (prev ? { ...prev, room: updated.room } : prev));
        await fetchMyRaceRooms();
        setStatusSuccess(`Updated member role for ${memberUserId}.`);
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, room, baseUrl, fetchMyRaceRooms, setStatusError, setStatusSuccess]
  );

  const updateMyRosterDisplayName = useCallback(
    async (displayName: string) => {
      if (!auth.accessToken || !room || !auth.claims?.sub) {
        throw new Error("Sign in and open a race room before updating your roster name.");
      }
      const trimmed = displayName.trim();
      if (!trimmed) {
        throw new Error("Name cannot be empty.");
      }
      const sub = auth.claims.sub;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const updated = await client.updateRaceRoomMemberDisplayName(room.id, sub, {
          displayName: trimmed
        });
        const patched = updated.room;
        /** Always persist the name we saved into local state (some responses omit nested fields). */
        const normalized: RaceRoom = {
          ...patched,
          memberships: patched.memberships.map((m) =>
            m.userId === sub ? { ...m, displayName: trimmed } : m
          ),
          creatorName: patched.athleteId === sub ? trimmed : patched.creatorName
        };
        setRoom(normalized);
        setRoomDetail((prev) => (prev ? { ...prev, room: normalized } : prev));
        if (normalized.athleteId === sub) {
          await saveRaceProfile({
            creatorName: trimmed,
            raceName: raceProfile?.raceName?.trim() || normalized.name || "",
            raceDescription: raceProfile?.raceDescription ?? normalized.description ?? "",
            crewName: raceProfile?.crewName ?? normalized.crewName ?? "",
            setupComplete: raceProfile?.setupComplete ?? true
          });
        }
        setMyRaceRooms((prev) => {
          if (!prev?.length) {
            return [normalized];
          }
          const idx = prev.findIndex((r) => r.id === normalized.id);
          if (idx === -1) {
            return [...prev, normalized];
          }
          const next = [...prev];
          next[idx] = normalized;
          return next;
        });
        setStatusSuccess("Your roster name was updated.");
      } catch (err) {
        setStatusError(err);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [
      auth.accessToken,
      auth.claims?.sub,
      room,
      baseUrl,
      raceProfile,
      saveRaceProfile,
      setStatusError,
      setStatusSuccess
    ]
  );

  useEffect(() => {
    if (
      auth.status !== "authenticated" ||
      onboardingIntent !== "joinCrew" ||
      !onboardingJoinDraft?.roomCode ||
      !onboardingJoinDraft.displayName
    ) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const joined = await joinRoomByCode(onboardingJoinDraft.roomCode);
        if (!joined || cancelled) {
          return;
        }
        await updateMyRosterDisplayName(onboardingJoinDraft.displayName);
        await SecureStore.deleteItemAsync(ONBOARDING_JOIN_DRAFT_KEY);
        await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, "none");
        if (!cancelled) {
          await refreshOnboardingStage();
        }
      } catch {
        /* surfaced via existing API status handlers */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    auth.status,
    joinRoomByCode,
    onboardingIntent,
    onboardingJoinDraft,
    refreshOnboardingStage,
    updateMyRosterDisplayName
  ]);

  useEffect(() => {
    if (auth.status !== "authenticated" || !onboardingNotificationsSeen || onboardingIntent === "none") {
      return;
    }
    void (async () => {
      await SecureStore.setItemAsync(ONBOARDING_INTENT_KEY, "none");
      await SecureStore.setItemAsync(ONBOARDING_NOTIFICATIONS_REQUIRED_KEY, "false");
      await refreshOnboardingStage();
    })();
  }, [auth.status, onboardingIntent, onboardingNotificationsSeen, refreshOnboardingStage]);

  const removeMember = useCallback(
    async (memberUserId: string) => {
      if (!auth.accessToken || !room) return;
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const updated = await client.removeRaceRoomMember(room.id, memberUserId);
        setRoom(updated.room);
        setRoomDetail((prev) => (prev ? { ...prev, room: updated.room } : prev));
        await fetchMyRaceRooms();
        setStatusSuccess(`Removed ${memberUserId} from room members.`);
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, room, baseUrl, fetchMyRaceRooms, setStatusError, setStatusSuccess]
  );

  const selectRaceRoom = useCallback(
    async (selectedRoom: RaceRoom) => {
      if (!auth.accessToken) return;
      setRoom(selectedRoom);
      setBusy(true);
      setApiError(undefined);
      try {
        const client = createApiClient({ baseUrl, accessToken: auth.accessToken });
        const [detail, { invites: nextInvites }] = await Promise.all([
          client.getRaceRoom(selectedRoom.id),
          client.getInvites(selectedRoom.id)
        ]);
        setRoom(detail.room);
        setRoomDetail(detail);
        setInvites(nextInvites);
        setStatusSuccess(`Selected race ${detail.room.name}.`);
      } catch (err) {
        setStatusError(err);
      } finally {
        setBusy(false);
      }
    },
    [auth.accessToken, baseUrl, setStatusError, setStatusSuccess]
  );

  const enqueueManualStop = useCallback(
    async (checkpointId: string, arrivalAt: string, departureAt: string) => {
      if (!room) return;
      const conflictKey = `manual-stop:${room.id}:${checkpointId}:${arrivalAt}`;
      await enqueueWithConflictKey(
        {
          id: conflictKey,
          type: "checkpoint",
          payload: { roomId: room.id, checkpointId, action: "manual_stop", arrivalAt, departureAt },
          attempts: 0,
          status: "pending"
        },
        conflictKey
      );
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

  const setProjectionPollEnabledExplicit = useCallback((enabled: boolean) => {
    setProjectionPollEnabled(enabled);
  }, []);

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
    raceProfile,
    onboardingIntent,
    onboardingJoinDraft,
    onboardingNotificationsSeen,
    onboardingNotificationsRequired,
    roomDetail,
    invites,
    myRaceRooms,
    lastPing,
    syncHealth,
    queueDiagnostics,
    mergeRecords,
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
    canLogMergeTelemetry,
    stationArrivalAt,
    describeOutboxOperation,
    describeOutboxStatus,
    onCreateRoom: createRoom,
    onSaveRaceProfile: saveRaceProfile,
    onProcessOutbox: processOutboxAction,
    onMarkEntitlementPaid: markEntitlementPaid,
    onFetchRoomDetails: fetchRoomDetails,
    onApplyRaceRoomFromServer: applyRaceRoomFromServer,
    onIssueInvite: issueInvite,
    onFetchInvites: fetchInvites,
    onJoinRoomByCode: joinRoomByCode,
    onUpdateMemberRole: updateMemberRole,
    onUpdateMyRosterDisplayName: updateMyRosterDisplayName,
    onRemoveMember: removeMember,
    onFetchMyRaceRooms: fetchMyRaceRooms,
    onSelectRaceRoom: selectRaceRoom,
    onSendPing: sendPing,
    onPostSyncHeartbeat: postSyncHeartbeat,
    onFetchSyncHealth: fetchSyncHealth,
    onRefreshWs5Telemetry: refreshWs5Telemetry,
    onPushQueueDiagnosticsSnapshot: pushQueueDiagnosticsSnapshot,
    onRecordOutboxMergeTelemetry: recordOutboxMergeTelemetry,
    onFetchProjection: fetchProjection,
    onRefreshProjectionQuiet: refreshProjectionQuiet,
    onToggleProjectionPoll: () => {
      setProjectionPollEnabled((v) => !v);
    },
    onSetProjectionPollEnabled: setProjectionPollEnabledExplicit,
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
    onEnqueueManualStop: (checkpointId, arrivalAt, departureAt) => {
      void enqueueManualStop(checkpointId, arrivalAt, departureAt ?? new Date().toISOString());
    },
    onSignOut: auth.signOut,
    onToggleResolvedSource: enqueueSourceToggle,
    onEnqueueTaskAction: enqueueTaskAction,
    onRetryOutboxOperationSafely: retryOutboxOperationSafely,
    onRefreshOnboardingStage: refreshOnboardingStage
  };

  const pendingAthleteSetup = auth.status === "authenticated" && onboardingIntent === "signupAthlete";
  const pendingJoinCompletion =
    auth.status === "authenticated" &&
    onboardingIntent === "joinCrew" &&
    !!onboardingJoinDraft?.roomCode &&
    !!onboardingJoinDraft.displayName;
  const pendingNotificationsPrompt =
    auth.status === "authenticated" &&
    onboardingNotificationsRequired &&
    !onboardingNotificationsSeen &&
    !pendingJoinCompletion;
  const showAuthedTabs =
    auth.status === "authenticated" &&
    !pendingAthleteSetup &&
    !pendingJoinCompletion &&
    !pendingNotificationsPrompt;

  const showAuthedTabsRef = useRef(showAuthedTabs);
  showAuthedTabsRef.current = showAuthedTabs;
  const pendingAuthedDeeplinkRef = useRef<string | null>(null);

  const linking = useMemo(
    () =>
      buildCrewCueLinking({
        showAuthedTabs,
        showAuthedTabsRef,
        onDeferAuthedDeepLink: (url) => {
          pendingAuthedDeeplinkRef.current = url;
        }
      }),
    [showAuthedTabs]
  );

  useEffect(() => {
    if (!showAuthedTabs || !pendingAuthedDeeplinkRef.current) return;
    const url = pendingAuthedDeeplinkRef.current;
    pendingAuthedDeeplinkRef.current = null;
    const path = pathFromCrewCueUrl(url);
    if (!path) return;
    const state = navigationStateForAuthedDeepLink(path);
    if (!state) return;

    const apply = () => {
      if (!crewCueNavigationRef.isReady()) return false;
      crewCueNavigationRef.reset(state);
      return true;
    };

    if (apply()) return;
    const timer = setInterval(() => {
      if (apply()) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [showAuthedTabs]);

  return (
    <AuthedShellProvider value={shellValue}>
      {showAuthedTabs ? <RaceChatPrefetcher /> : null}
      <NavigationContainer
        ref={crewCueNavigationRef}
        theme={navigationTheme}
        linking={linking}
        key={showAuthedTabs ? "authed-tabs" : "guest-stack"}
      >
        {showAuthedTabs ? <CrewMainTabs /> : <GuestStack />}
      </NavigationContainer>
      <TransientNoticeHost />
      <StatusBar style="dark" />
    </AuthedShellProvider>
  );
}

const bootStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CANVAS_BACKGROUND_COLOR
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 16
  },
  card: {
    borderRadius: 16,
    padding: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d1c4",
    gap: 4
  },
  title: {
    color: "#111827",
    fontSize: 26,
    fontWeight: "700"
  },
  subtitle: {
    color: "#5c5a54",
    fontSize: 14,
    marginBottom: 12
  },
  label: {
    color: "#5c5a54",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 10
  },
  value: {
    color: "#111827",
    fontSize: 16
  },
  code: {
    color: "#111827",
    fontSize: 13,
    fontFamily: "Menlo"
  },
  body: {
    color: "#5c5a54",
    fontSize: 14,
    marginTop: 6
  },
  mutedText: {
    color: "#5c5a54"
  },
  successText: {
    color: "#86efac"
  },
  warningText: {
    color: "#fde68a"
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13
  },
  primaryButton: {
    backgroundColor: "#6B46C1",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center"
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600"
  },
  secondaryButton: {
    backgroundColor: "#e7e5de",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center"
  },
  secondaryButtonLabel: {
    color: "#1f2937",
    fontSize: 14
  },
  secondaryButtonActive: {
    borderWidth: 2,
    borderColor: "#6B46C1"
  },
  summaryCard: {
    marginTop: 16,
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d1c4"
  },
  summaryTitle: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4
  },
  statusRail: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d8d1c4",
    gap: 4
  },
  statusRailTitle: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  statusRailItem: {
    color: "#5c5a54",
    fontSize: 13
  },
  outboxItem: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#d8d1c4",
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
    borderBottomColor: "#d8d1c4"
  },
  visitRow: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: "#7a756c"
  },
  toggleButton: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "#e7e5de",
    alignSelf: "flex-start"
  },
  toggleButtonLabel: {
    color: "#1f2937",
    fontSize: 12
  }
});

function createAuthedStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.background
    },
    scroll: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 16
    },
    card: {
      borderRadius: theme.radius.lg,
      padding: theme.spacing.cardPadding,
      backgroundColor: theme.color.card,
      borderWidth: 1,
      borderColor: theme.color.divider,
      gap: 4
    },
    title: {
      color: theme.color.text,
      fontSize: 26,
      fontWeight: "700"
    },
    subtitle: {
      color: theme.color.authBody,
      fontSize: 14,
      marginBottom: 12
    },
    label: {
      color: theme.color.authBody,
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: 10
    },
    value: {
      color: theme.color.text,
      fontSize: 16
    },
    code: {
      color: theme.color.authHeading,
      fontSize: 13,
      fontFamily: "Menlo"
    },
    body: {
      color: theme.color.authBody,
      fontSize: 14,
      marginTop: 6
    },
    mutedText: {
      color: theme.color.authBody
    },
    successText: {
      color: theme.color.success
    },
    warningText: {
      color: theme.color.warning
    },
    errorText: {
      color: theme.color.danger,
      fontSize: 13
    },
    primaryButton: {
      backgroundColor: theme.color.authPrimaryAction,
      paddingVertical: theme.spacing.base + 4,
      paddingHorizontal: theme.spacing.base * 2,
      borderRadius: theme.radius.full,
      minHeight: theme.spacing.touchTargetMin,
      alignItems: "center"
    },
    primaryButtonLabel: {
      color: theme.color.authPrimaryActionText,
      fontSize: 17,
      fontWeight: "700"
    },
    secondaryButton: {
      backgroundColor: theme.color.authSecondaryAction,
      paddingVertical: theme.spacing.base + 4,
      paddingHorizontal: theme.spacing.base * 2,
      borderRadius: theme.radius.full,
      minHeight: theme.spacing.touchTargetMin,
      alignItems: "center"
    },
    secondaryButtonLabel: {
      color: theme.color.authSecondaryActionText,
      fontSize: 17,
      fontWeight: "700"
    },
    secondaryButtonActive: {
      borderWidth: 2,
      borderColor: theme.color.secondaryButtonActiveBorder
    },
    summaryCard: {
      marginTop: 16,
      borderRadius: theme.radius.lg,
      padding: 14,
      backgroundColor: theme.color.summaryCard,
      borderWidth: 1,
      borderColor: theme.color.divider
    },
    summaryTitle: {
      color: theme.color.authHeading,
      fontSize: 15,
      fontWeight: "600",
      marginBottom: 4
    },
    statusRail: {
      marginTop: 12,
      padding: 12,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.statusRail,
      borderWidth: 1,
      borderColor: theme.color.divider,
      gap: 4
    },
    statusRailTitle: {
      color: theme.color.authHeading,
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5
    },
    statusRailItem: {
      color: theme.color.authBody,
      fontSize: 13
    },
    sectionDivider: {
      borderTopWidth: 1,
      borderTopColor: theme.color.divider,
      paddingTop: 12
    },
    outboxItem: {
      marginTop: 12,
      borderTopWidth: 1,
      borderTopColor: theme.color.divider,
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
      color: theme.color.warning
    },
    outboxStatusSent: {
      color: theme.color.success
    },
    outboxStatusRejected: {
      color: theme.color.danger
    },
    outboxStatusConflict: {
      color: theme.color.warning
    },
    stoppageRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 5,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.divider
    },
    visitRow: {
      marginTop: 8,
      paddingLeft: 10,
      borderLeftWidth: 2,
      borderLeftColor: theme.color.visitBorder
    },
    toggleButton: {
      marginTop: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 6,
      backgroundColor: theme.color.authSecondaryAction,
      alignSelf: "flex-start"
    },
    toggleButtonLabel: {
      color: theme.color.authSecondaryActionText,
      fontSize: 12
    }
  });
}
