import type { PacingEstimate } from "@crewcue/contracts";
import { useMemo, type ReactElement } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { DSCard, useDSTheme, type DSThemeTokens } from "../../design-system";
import { formatDurationSeconds, formatScheduleClock } from "./formatSchedule";

export type ColdStartEstimatePanelProps = {
  estimate: PacingEstimate;
  /** When true, CTA is disabled (EC8 — no double-submit). */
  addingHistory?: boolean;
  onAddHistory?: () => void;
  /** Optional error from estimate fetch / add-history attempt. */
  error?: string;
};

/**
 * Cold-start UX: coarse finish clocks from the API estimate + prompt to add history.
 * Hidden by the parent when `estimate.coldStart` becomes false (EC5).
 */
export function ColdStartEstimatePanel(props: ColdStartEstimatePanelProps): ReactElement | null {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!props.estimate.coldStart) {
    return null;
  }

  const finishClock = formatScheduleClock(props.estimate.expectedFinishAt);
  const finishElapsed = formatDurationSeconds(props.estimate.expectedFinishElapsedSeconds);
  const adding = props.addingHistory === true;

  return (
    <View accessibilityLabel="Cold start estimate">
      <DSCard style={styles.card}>
        <Text style={styles.kicker} accessibilityLabel="Cold start prompt">
          Coarse estimate · no activity history yet
        </Text>
        <Text style={styles.finish} accessibilityLabel={`Cold start finish ${finishClock}`}>
          Expected finish {finishClock}
        </Text>
        <Text style={styles.meta} accessibilityLabel={`Cold start elapsed ${finishElapsed}`}>
          Elapsed {finishElapsed} (course-only)
        </Text>
        <Text style={styles.body} accessibilityLabel="Cold start explanation">
          {props.estimate.explanation} Connect Strava to sync your last year of runs for better pacing
          estimates.
        </Text>
        {props.error ? (
          <Text style={styles.error} accessibilityLabel="Cold start estimate error">
            {props.error}
          </Text>
        ) : null}
        {props.onAddHistory ? (
          <Pressable
            onPress={props.onAddHistory}
            disabled={adding}
            accessibilityRole="button"
            accessibilityLabel="Connect Strava"
            accessibilityState={{ disabled: adding, busy: adding }}
            style={[styles.cta, adding ? styles.ctaDisabled : null]}
          >
            {adding ? (
              <ActivityIndicator accessibilityLabel="Adding activity history" color={theme.color.text} />
            ) : (
              <Text style={styles.ctaLabel}>Connect Strava</Text>
            )}
          </Pressable>
        ) : null}
      </DSCard>
    </View>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    card: {
      marginBottom: 8,
      gap: 6
    },
    kicker: {
      color: theme.color.primary,
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.4
    },
    finish: {
      color: theme.color.text,
      fontSize: 18,
      fontWeight: "800"
    },
    meta: {
      color: theme.color.body,
      lineHeight: 20
    },
    body: {
      color: theme.color.body,
      lineHeight: 20,
      marginTop: 2
    },
    error: {
      color: theme.color.danger,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4
    },
    cta: {
      alignSelf: "flex-start",
      marginTop: 8,
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center"
    },
    ctaDisabled: {
      opacity: 0.55
    },
    ctaLabel: {
      color: theme.color.onPrimary,
      fontWeight: "700"
    }
  });
}
