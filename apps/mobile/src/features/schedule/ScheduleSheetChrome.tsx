import type { CrewScheduleSheet, PacingEstimate } from "@crewcue/contracts";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useDSTheme, type DSThemeTokens } from "../../design-system";
import { ColdStartEstimatePanel } from "./ColdStartEstimatePanel";
import {
  buildCrewSheetExportText,
  type CrewSheetNoteBodies
} from "./crewSheetExport";
import { formatScheduleClock } from "./formatSchedule";
import { shareCrewSheetText } from "./shareCrewSheet";

export type ScheduleSheetChromeProps = {
  sheet: CrewScheduleSheet;
  titleByCheckpointId?: Map<string, string>;
  canEditStopPlans?: boolean;
  canEditCheckIn?: boolean;
  actionError?: string;
  pacingEstimate?: PacingEstimate | null;
  addingHistory?: boolean;
  onAddHistory?: () => void;
  estimateError?: string;
  onRecalculateFromHistory?: () => void;
  recalculating?: boolean;
  noteBodiesByCheckpointId?: ReadonlyMap<string, CrewSheetNoteBodies>;
  showCrewSheetExport?: boolean;
  compact?: boolean;
};

/**
 * Room-level schedule chrome: estimate, share/print, role hints.
 * Presentational — does not recompute clocks.
 */
export function ScheduleSheetChrome(props: ScheduleSheetChromeProps): ReactElement {
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

  return (
    <View style={styles.header}>
      {props.pacingEstimate?.coldStart === true ? (
        <ColdStartEstimatePanel
          estimate={props.pacingEstimate}
          addingHistory={props.addingHistory}
          onAddHistory={props.onAddHistory}
          error={props.estimateError}
        />
      ) : null}
      {props.pacingEstimate && props.pacingEstimate.coldStart !== true ? (
        <Text style={styles.estimateExplanation} accessibilityLabel="Pacing estimate explanation">
          {props.pacingEstimate.explanation}
        </Text>
      ) : null}
      {props.onRecalculateFromHistory ? (
        <Pressable
          onPress={props.onRecalculateFromHistory}
          disabled={props.recalculating === true}
          accessibilityRole="button"
          accessibilityLabel="Recalculate from my history"
          accessibilityState={{
            disabled: props.recalculating === true,
            busy: props.recalculating === true
          }}
          style={[styles.recalcBtn, props.recalculating ? styles.recalcBtnDisabled : null]}
        >
          {props.recalculating ? (
            <ActivityIndicator accessibilityLabel="Recalculating from history" color={theme.color.text} />
          ) : (
            <Text style={styles.recalcLabel}>Recalculate from my history</Text>
          )}
        </Pressable>
      ) : null}
      {props.estimateError && props.pacingEstimate?.coldStart !== true ? (
        <Text style={styles.actionError} accessibilityLabel="Pacing estimate error">
          {props.estimateError}
        </Text>
      ) : null}
      {props.compact !== true ? (
        <>
          <Text style={styles.kicker}>Crew schedule</Text>
          <Text style={styles.subtitle}>
            Race start {formatScheduleClock(props.sheet.raceStartAt)} · times from the server (not
            recomputed on device)
          </Text>
        </>
      ) : (
        <Text style={styles.subtitle}>
          Race start {formatScheduleClock(props.sheet.raceStartAt)} · times from the server
        </Text>
      )}
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
          <Text style={styles.shareLabel}>{exporting ? "Preparing share…" : "Share / print crew sheet"}</Text>
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
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
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
    estimateExplanation: {
      color: theme.color.body,
      lineHeight: 20,
      marginBottom: 4
    },
    recalcBtn: {
      alignSelf: "flex-start",
      marginTop: 4,
      backgroundColor: theme.color.secondaryButton,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 14,
      justifyContent: "center"
    },
    recalcBtnDisabled: {
      opacity: 0.55
    },
    recalcLabel: {
      color: theme.color.text,
      fontWeight: "700"
    }
  });
}
