import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
import { useMemo, type ReactElement } from "react";
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
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";

export function stopAccessibilityLabel(
  title: string,
  stop: ScheduleStop,
  clockLabel: string,
  elapsedLabel: string,
  dwellLabel: string
): string {
  const delay =
    typeof stop.delayOverrideSeconds === "number"
      ? `, delay ${formatDurationSeconds(stop.delayOverrideSeconds)}`
      : "";
  return `Schedule stop ${title}, arrival ${clockLabel}, elapsed ${elapsedLabel}, dwell ${dwellLabel}${delay}`;
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
};

/**
 * Presentational crew schedule sheet (read-only). Formats API clocks/durations only —
 * does not recompute arrival from elapsed + raceStartAt.
 */
export function CrewScheduleSheetView(props: CrewScheduleSheetViewProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const titleByCheckpointId = props.titleByCheckpointId ?? new Map<string, string>();

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
      keyExtractor={(item) => item.id}
      accessibilityLabel="Schedule sheet"
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
            <Text style={styles.kicker}>Crew schedule</Text>
            <Text style={styles.subtitle}>
              Race start {formatScheduleClock(props.sheet.raceStartAt)} · times from the server (not
              recomputed on device)
            </Text>
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
        const dwellLabel = formatDurationSeconds(item.plannedDwellSeconds);
        const hasDelay = typeof item.delayOverrideSeconds === "number";
        return (
          <View
            accessible
            accessibilityLabel={stopAccessibilityLabel(title, item, clockLabel, elapsedLabel, dwellLabel)}
          >
            <DSCard style={styles.row}>
              <Text style={styles.rowTitle}>
                {index + 1}. {title}
              </Text>
              <Text style={styles.meta}>Arrival {clockLabel}</Text>
              <Text style={styles.meta}>Elapsed {elapsedLabel}</Text>
              <Text style={styles.meta}>Dwell {dwellLabel}</Text>
              {hasDelay ? (
                <Text style={styles.delay}>Delay {formatDurationSeconds(item.delayOverrideSeconds!)}</Text>
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
    }
  });
}
