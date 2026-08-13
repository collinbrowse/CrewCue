import type { CrewScheduleSheet, ScheduleStop } from "@crewcue/contracts";
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
import { useFocusEffect } from "@react-navigation/native";
import { createApiClient } from "../api/client";
import { DSCard, useDSTheme, type DSThemeTokens } from "../design-system";
import { formatDurationSeconds, formatScheduleClock } from "../features/schedule/formatSchedule";
import { mapScheduleFetchError } from "../features/schedule/scheduleErrors";
import { checkpointDisplayTitle } from "../features/pace/timeline";
import { useAuthedShell } from "../shell/AuthedShellContext";

function stopAccessibilityLabel(
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

export function CrewScheduleSheetScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const room = s.room;
  const titleByCheckpointId = useMemo(() => {
    const map = new Map<string, string>();
    for (const cp of room?.course?.checkpoints ?? []) {
      map.set(cp.id, checkpointDisplayTitle(cp));
    }
    return map;
  }, [room?.course?.checkpoints]);

  const [sheet, setSheet] = useState<CrewScheduleSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(
    async (mode: "initial" | "refresh") => {
      if (!room?.id || !s.auth.accessToken) {
        setSheet(null);
        setError(undefined);
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (mode === "initial") {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(undefined);
      try {
        const client = createApiClient({ baseUrl: s.baseUrl, accessToken: s.auth.accessToken });
        const next = await client.getSchedule(room.id);
        setSheet(next);
      } catch (err) {
        setSheet(null);
        setError(mapScheduleFetchError(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [room?.id, s.auth.accessToken, s.baseUrl]
  );

  useFocusEffect(
    useCallback(() => {
      void load("initial");
    }, [load])
  );

  if (!room) {
    return (
      <View style={styles.container} accessibilityLabel="Schedule sheet">
        <Text style={styles.body}>Select a race room to view the crew schedule.</Text>
      </View>
    );
  }

  if (loading && !sheet) {
    return (
      <View style={styles.centered} accessibilityLabel="Schedule sheet loading">
        <ActivityIndicator accessibilityLabel="Loading schedule" color={theme.color.primary} />
        <Text style={[styles.body, styles.loadingCopy]}>Loading crew schedule…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container} accessibilityLabel="Schedule sheet error">
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          onPress={() => void load("initial")}
          accessibilityRole="button"
          accessibilityLabel="Retry schedule"
          style={styles.retryButton}
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const stops = sheet?.stops ?? [];

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={stops}
      keyExtractor={(item) => item.id}
      accessibilityLabel="Schedule sheet"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor={theme.color.primary} />
      }
      ListHeaderComponent={
        sheet ? (
          <View style={styles.header}>
            <Text style={styles.kicker}>Crew schedule</Text>
            <Text style={styles.subtitle}>
              Race start {formatScheduleClock(sheet.raceStartAt)} · times from the server (not recomputed on device)
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
