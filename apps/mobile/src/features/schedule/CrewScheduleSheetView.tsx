import type { CrewScheduleSheet, PacingEstimate, ScheduleStop } from "@crewcue/contracts";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from "react-native";
import { DSCard, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { ManualCheckpointStopInput, StopPlanResponse, UpsertStopPlanInput } from "../../api/client";
import { CheckInEditor } from "./CheckInEditor";
import { ColdStartEstimatePanel } from "./ColdStartEstimatePanel";
import {
  buildCrewSheetExportText,
  type CrewSheetNoteBodies
} from "./crewSheetExport";
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";
import { shareCrewSheetText } from "./shareCrewSheet";
import { StopPlanEditor } from "./StopPlanEditor";

export function stopAccessibilityLabel(
  title: string,
  stop: ScheduleStop,
  clockLabel: string,
  elapsedLabel: string,
  stoppageLabel: string
): string {
  const delay =
    typeof stop.delayOverrideSeconds === "number"
      ? `, delay ${formatDurationSeconds(stop.delayOverrideSeconds)}`
      : "";
  return `Schedule stop ${title}, arrival ${clockLabel}, elapsed ${elapsedLabel}, stoppage ${stoppageLabel}${delay}`;
}

export type CrewScheduleSheetViewProps = {
  sheet: CrewScheduleSheet | null;
  loading: boolean;
  refreshing?: boolean;
  error?: string;
  titleByCheckpointId?: Map<string, string>;
  onRetry?: () => void;
  onRefresh?: () => void;
  /** Optional empty-room / setup copy when there is no sheet yet and no error. */
  emptyRoomMessage?: string;
  /** Course editors can mutate stop-plan overlays; others stay read-only. */
  canEditStopPlans?: boolean;
  editingCheckpointId?: string | null;
  onEditStop?: (checkpointId: string) => void;
  onCancelEdit?: () => void;
  editingPlan?: StopPlanResponse | null;
  loadingPlan?: boolean;
  savingPlan?: boolean;
  saveError?: string;
  /** Shown in the sheet header when the inline editor is closed (e.g. failed plan load). */
  actionError?: string;
  onSaveStopPlan?: (checkpointId: string, input: UpsertStopPlanInput) => void;
  onClearStopDelay?: (checkpointId: string) => void;
  onClearAthleteNotes?: (checkpointId: string) => void;
  onClearPlanNotes?: (checkpointId: string) => void;
  onClearStopPlan?: (checkpointId: string) => void;
  /** Stoppage editors can submit closed check-in (arrival+departure). */
  canEditCheckIn?: boolean;
  checkInCheckpointId?: string | null;
  onOpenCheckIn?: (checkpointId: string) => void;
  onCancelCheckIn?: () => void;
  savingCheckIn?: boolean;
  checkInError?: string;
  onSaveCheckIn?: (checkpointId: string, input: ManualCheckpointStopInput) => void;
  /** When `coldStart: true`, show coarse estimate + add-history prompt (W3-5). */
  pacingEstimate?: PacingEstimate | null;
  addingHistory?: boolean;
  onAddHistory?: () => void;
  estimateError?: string;
  /**
   * Optional note bodies for offline crew-sheet export when the sheet only has note ids.
   * Export builds plaintext from the in-memory sheet (no network refetch).
   */
  noteBodiesByCheckpointId?: ReadonlyMap<string, CrewSheetNoteBodies>;
  /** When false, hide Share / print. Default true when a sheet model is available. */
  showCrewSheetExport?: boolean;
};

/**
 * Presentational crew schedule sheet. Formats API clocks/durations only —
 * does not recompute arrival from elapsed + raceStartAt after live saves
 * (parent refetches `getSchedule`). DEV fixture may supply an updated sheet.
 */
export function CrewScheduleSheetView(props: CrewScheduleSheetViewProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const titleByCheckpointId = props.titleByCheckpointId ?? new Map<string, string>();
  const canEdit = props.canEditStopPlans === true;
  const canCheckIn = props.canEditCheckIn === true;
  const showExport = props.showCrewSheetExport !== false;
  const [exportStatus, setExportStatus] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  const onShareCrewSheet = useCallback(async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    setExportStatus(undefined);
    try {
      const message = buildCrewSheetExportText(props.sheet, {
        titleByCheckpointId,
        noteBodiesByCheckpointId: props.noteBodiesByCheckpointId
      });
      const result = await shareCrewSheetText(message);
      if (result.ok) {
        setExportStatus("Crew sheet shared (offline snapshot).");
      } else if (result.reason === "dismissed") {
        setExportStatus(undefined);
      } else {
        setExportStatus(result.message ?? "Could not open share sheet.");
      }
    } finally {
      setExporting(false);
    }
  }, [exporting, props.sheet, props.noteBodiesByCheckpointId, titleByCheckpointId]);

  if (props.emptyRoomMessage && !props.sheet && !props.loading && !props.error) {
    return (
      <View style={styles.container} accessibilityLabel="Schedule sheet">
        <Text style={styles.body}>{props.emptyRoomMessage}</Text>
      </View>
    );
  }

  if (props.loading && !props.sheet) {
    return (
      <View style={styles.centered} accessibilityLabel="Schedule sheet loading">
        <ActivityIndicator accessibilityLabel="Loading schedule" color={theme.color.primary} />
        <Text style={[styles.body, styles.loadingCopy]}>Loading crew schedule…</Text>
      </View>
    );
  }

  if (props.error) {
    return (
      <View style={styles.container} accessibilityLabel="Schedule sheet error">
        <Text style={styles.errorText}>{props.error}</Text>
        {props.onRetry ? (
          <Pressable
            onPress={props.onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry schedule"
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const stops = props.sheet?.stops ?? [];

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={stops}
      extraData={`${props.sheet?.raceStartAt ?? ""}:${stops.map((s) => `${s.checkpointId}:${s.delayOverrideSeconds ?? ""}:${s.clockArrivalAt}`).join("|")}:${props.editingCheckpointId ?? ""}:${props.checkInCheckpointId ?? ""}:${props.savingPlan ? "1" : "0"}:${props.savingCheckIn ? "1" : "0"}:${props.actionError ?? ""}:${props.pacingEstimate?.id ?? ""}:${props.pacingEstimate?.coldStart ? "1" : "0"}:${props.addingHistory ? "1" : "0"}:${props.estimateError ?? ""}:${exporting ? "1" : "0"}:${exportStatus ?? ""}`}
      keyExtractor={(item) => item.id}
      accessibilityLabel="Schedule sheet"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        props.onRefresh ? (
          <RefreshControl
            refreshing={Boolean(props.refreshing)}
            onRefresh={props.onRefresh}
            tintColor={theme.color.primary}
          />
        ) : undefined
      }
      ListHeaderComponent={
        props.sheet ? (
          <View style={styles.header}>
            {props.pacingEstimate?.coldStart === true ? (
              <ColdStartEstimatePanel
                estimate={props.pacingEstimate}
                addingHistory={props.addingHistory}
                onAddHistory={props.onAddHistory}
                error={props.estimateError}
              />
            ) : null}
            <Text style={styles.kicker}>Crew schedule</Text>
            <Text style={styles.subtitle}>
              Race start {formatScheduleClock(props.sheet.raceStartAt)} · times from the server (not
              recomputed on device)
            </Text>
            {showExport ? (
              <Pressable
                onPress={() => {
                  void onShareCrewSheet();
                }}
                disabled={exporting}
                accessibilityRole="button"
                accessibilityLabel="Share crew sheet"
                accessibilityHint="Exports an offline plaintext snapshot of this schedule"
                style={styles.shareBtn}
              >
                <Text style={styles.shareLabel}>
                  {exporting ? "Preparing share…" : "Share / print crew sheet"}
                </Text>
              </Pressable>
            ) : null}
            {exportStatus ? (
              <Text style={styles.exportStatus} accessibilityLabel="Crew sheet export status">
                {exportStatus}
              </Text>
            ) : null}
            {!canEdit && !canCheckIn ? (
              <Text style={styles.readOnlyHint} accessibilityLabel="Schedule read only">
                Stop delay, notes, and check-in are read-only for your role.
              </Text>
            ) : !canEdit ? (
              <Text style={styles.readOnlyHint} accessibilityLabel="Schedule stop plans read only">
                Stop delay and notes are read-only for your role.
              </Text>
            ) : !canCheckIn ? (
              <Text style={styles.readOnlyHint} accessibilityLabel="Schedule check-in read only">
                Check-in is read-only for your role.
              </Text>
            ) : null}
            {props.actionError ? (
              <Text style={styles.actionError} accessibilityLabel="Stop plan action error">
                {props.actionError}
              </Text>
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        <Text style={styles.body} accessibilityLabel="Schedule empty">
          No stops on this schedule yet.
        </Text>
      }
      renderItem={({ item, index }) => {
        const title = titleByCheckpointId.get(item.checkpointId) ?? item.checkpointId;
        const clockLabel = formatScheduleClock(item.clockArrivalAt);
        const elapsedLabel = formatDurationSeconds(item.elapsedSeconds);
        const stoppageLabel = formatDurationSeconds(item.plannedStoppageSeconds);
        const hasDelay = typeof item.delayOverrideSeconds === "number";
        const isEditingPlan = props.editingCheckpointId === item.checkpointId;
        const isEditingCheckIn = props.checkInCheckpointId === item.checkpointId;
        const noteBits: string[] = [];
        if (item.notes?.athleteNotesId) {
          noteBits.push("athlete notes");
        }
        if (item.notes?.planNotesId) {
          noteBits.push("plan notes");
        }
        // When editors can act, keep the row non-accessible so Edit/Save controls stay
        // individually discoverable for VoiceOver / XcodeBuildMCP (parent accessible merges children).
        const rowAccessible = !canEdit && !canCheckIn && !isEditingPlan && !isEditingCheckIn;
        const defaultDepartureAt = new Date(
          Date.parse(item.clockArrivalAt) + Math.max(0, item.plannedStoppageSeconds) * 1000
        ).toISOString();
        return (
          <View
            accessible={rowAccessible}
            accessibilityLabel={
              rowAccessible
                ? stopAccessibilityLabel(title, item, clockLabel, elapsedLabel, stoppageLabel)
                : undefined
            }
          >
            <DSCard style={styles.row}>
              <Text
                style={styles.rowTitle}
                accessibilityLabel={stopAccessibilityLabel(title, item, clockLabel, elapsedLabel, stoppageLabel)}
              >
                {index + 1}. {title}
              </Text>
              <Text style={styles.meta}>Arrival {clockLabel}</Text>
              <Text style={styles.meta}>Elapsed {elapsedLabel}</Text>
              <Text style={styles.meta}>Stoppage {stoppageLabel}</Text>
              {hasDelay ? (
                <Text style={styles.delay} accessibilityLabel={`Delay ${item.delayOverrideSeconds} seconds`}>
                  Delay {formatDurationSeconds(item.delayOverrideSeconds!)}
                </Text>
              ) : null}
              {noteBits.length > 0 ? (
                <Text style={styles.meta}>Notes: {noteBits.join(", ")}</Text>
              ) : null}

              {(canEdit || canCheckIn) && !isEditingPlan && !isEditingCheckIn ? (
                <View style={styles.rowActions}>
                  {canEdit && props.onEditStop ? (
                    <Pressable
                      onPress={() => props.onEditStop?.(item.checkpointId)}
                      accessibilityRole="button"
                      accessibilityLabel="Edit stop delay"
                      style={styles.editBtn}
                    >
                      <Text style={styles.editLabel}>Edit delay & notes</Text>
                    </Pressable>
                  ) : null}
                  {canCheckIn && props.onOpenCheckIn ? (
                    <Pressable
                      onPress={() => props.onOpenCheckIn?.(item.checkpointId)}
                      accessibilityRole="button"
                      accessibilityLabel="Open check-in"
                      style={styles.editBtn}
                    >
                      <Text style={styles.editLabel}>Check in</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              {isEditingPlan && props.onSaveStopPlan && props.onCancelEdit ? (
                <StopPlanEditor
                  checkpointId={item.checkpointId}
                  plan={props.editingPlan ?? null}
                  loadingPlan={Boolean(props.loadingPlan)}
                  saving={Boolean(props.savingPlan)}
                  error={props.saveError}
                  canEdit={canEdit}
                  onSave={(input) => props.onSaveStopPlan?.(item.checkpointId, input)}
                  onClearDelay={() => props.onClearStopDelay?.(item.checkpointId)}
                  onClearAthleteNotes={() => props.onClearAthleteNotes?.(item.checkpointId)}
                  onClearPlanNotes={() => props.onClearPlanNotes?.(item.checkpointId)}
                  onClearAll={() => props.onClearStopPlan?.(item.checkpointId)}
                  onCancel={() => props.onCancelEdit?.()}
                />
              ) : null}

              {isEditingCheckIn && props.onSaveCheckIn && props.onCancelCheckIn ? (
                <CheckInEditor
                  checkpointId={item.checkpointId}
                  defaultArrivalAt={item.clockArrivalAt}
                  defaultDepartureAt={defaultDepartureAt}
                  saving={Boolean(props.savingCheckIn)}
                  error={props.checkInError}
                  canEdit={canCheckIn}
                  onSave={(input) => props.onSaveCheckIn?.(item.checkpointId, input)}
                  onCancel={() => props.onCancelCheckIn?.()}
                />
              ) : null}
            </DSCard>
          </View>
        );
      }}
    />
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.background,
      padding: 16
    },
    centered: {
      flex: 1,
      backgroundColor: theme.color.background,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12
    },
    list: {
      flex: 1,
      backgroundColor: theme.color.background
    },
    listContent: {
      padding: 16,
      paddingBottom: 32,
      gap: 10
    },
    header: {
      marginBottom: 8,
      gap: 6
    },
    kicker: {
      color: theme.color.text,
      fontSize: 22,
      fontWeight: "800"
    },
    subtitle: {
      color: theme.color.body,
      lineHeight: 20
    },
    shareBtn: {
      alignSelf: "flex-start",
      marginTop: 8,
      backgroundColor: theme.color.secondaryButton,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 14,
      justifyContent: "center"
    },
    shareLabel: {
      color: theme.color.text,
      fontWeight: "700"
    },
    exportStatus: {
      color: theme.color.body,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4
    },
    readOnlyHint: {
      color: theme.color.body,
      fontSize: 13,
      marginTop: 4
    },
    actionError: {
      color: theme.color.danger,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 6
    },
    body: {
      color: theme.color.body,
      lineHeight: 22
    },
    loadingCopy: {
      marginTop: 4
    },
    errorText: {
      color: theme.color.danger,
      lineHeight: 22,
      marginBottom: 16
    },
    retryButton: {
      alignSelf: "flex-start",
      backgroundColor: theme.color.secondaryButton,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center"
    },
    retryLabel: {
      color: theme.color.text,
      fontWeight: "700"
    },
    row: {
      marginTop: 0
    },
    rowTitle: {
      color: theme.color.text,
      fontSize: 17,
      fontWeight: "700",
      marginBottom: 6
    },
    meta: {
      color: theme.color.body,
      lineHeight: 20
    },
    delay: {
      color: theme.color.primary,
      fontWeight: "600",
      marginTop: 4,
      lineHeight: 20
    },
    rowActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      marginTop: 4
    },
    editBtn: {
      alignSelf: "flex-start",
      marginTop: 6,
      minHeight: theme.spacing.touchTargetMin,
      justifyContent: "center"
    },
    editLabel: {
      color: theme.color.primary,
      fontWeight: "700"
    }
  });
}
