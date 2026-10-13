import type { ScheduleStop } from "@crewcue/contracts";
import { useMemo, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DSCard, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { ManualCheckpointStopInput, StopPlanResponse, UpsertStopPlanInput } from "../../api/client";
import { CheckInEditor } from "./CheckInEditor";
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";
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
  const split =
    typeof stop.movingElapsedSeconds === "number"
      ? `, moving ${formatDurationSeconds(stop.movingElapsedSeconds)}, waited ${formatDurationSeconds(
          Math.max(0, stop.elapsedSeconds - stop.movingElapsedSeconds)
        )}`
      : "";
  return `Schedule stop ${title}, arrival ${clockLabel}, elapsed ${elapsedLabel}${split}, stoppage ${stoppageLabel}${delay}`;
}

export type ScheduleStopCardProps = {
  stop: ScheduleStop;
  title: string;
  displayIndex: number;
  canEditStopPlans?: boolean;
  canEditCheckIn?: boolean;
  editingCheckpointId?: string | null;
  onEditStop?: (checkpointId: string) => void;
  onCancelEdit?: () => void;
  editingPlan?: StopPlanResponse | null;
  loadingPlan?: boolean;
  savingPlan?: boolean;
  saveError?: string;
  onSaveStopPlan?: (checkpointId: string, input: UpsertStopPlanInput) => void;
  onClearStopDelay?: (checkpointId: string) => void;
  onClearAthleteNotes?: (checkpointId: string) => void;
  onClearPlanNotes?: (checkpointId: string) => void;
  onClearStopPlan?: (checkpointId: string) => void;
  checkInCheckpointId?: string | null;
  onOpenCheckIn?: (checkpointId: string) => void;
  onCancelCheckIn?: () => void;
  savingCheckIn?: boolean;
  checkInError?: string;
  onSaveCheckIn?: (checkpointId: string, input: ManualCheckpointStopInput) => void;
};

export function ScheduleStopCard(props: ScheduleStopCardProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const canEdit = props.canEditStopPlans === true;
  const canCheckIn = props.canEditCheckIn === true;
  const item = props.stop;
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
  const rowAccessible = !canEdit && !canCheckIn && !isEditingPlan && !isEditingCheckIn;
  const defaultDepartureAt = new Date(
    Date.parse(item.clockArrivalAt) + Math.max(0, item.plannedStoppageSeconds) * 1000
  ).toISOString();

  return (
    <View
      accessible={rowAccessible}
      accessibilityLabel={
        rowAccessible
          ? stopAccessibilityLabel(props.title, item, clockLabel, elapsedLabel, stoppageLabel)
          : undefined
      }
    >
      <DSCard style={styles.row}>
        <Text
          style={styles.rowTitle}
          accessibilityLabel={stopAccessibilityLabel(props.title, item, clockLabel, elapsedLabel, stoppageLabel)}
        >
          {props.displayIndex}. {props.title}
        </Text>
        <Text style={styles.meta}>Arrival {clockLabel}</Text>
        <Text style={styles.meta}>Elapsed {elapsedLabel}</Text>
        {typeof item.movingElapsedSeconds === "number" ? (
          <Text style={styles.meta} accessibilityLabel="Moving vs waiting split">
            Moving {formatDurationSeconds(item.movingElapsedSeconds)} · Waited{" "}
            {formatDurationSeconds(Math.max(0, item.elapsedSeconds - item.movingElapsedSeconds))}
          </Text>
        ) : null}
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
                accessibilityLabel="Edit delay & notes"
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
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
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
