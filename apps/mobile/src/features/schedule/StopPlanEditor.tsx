import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { DSTextInput, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { StopPlanResponse, UpsertStopPlanInput } from "../../api/client";

export type StopPlanEditorProps = {
  checkpointId: string;
  /** Loaded overlay (bodies for notes). Null while loading or when empty. */
  plan: StopPlanResponse | null;
  loadingPlan: boolean;
  saving: boolean;
  error?: string;
  canEdit: boolean;
  onSave: (input: UpsertStopPlanInput) => void;
  onClearDelay: () => void;
  onClearAthleteNotes: () => void;
  onClearPlanNotes: () => void;
  onClearAll: () => void;
  onCancel: () => void;
};

/**
 * Inline editor for delay override + athlete/plan notes.
 * Parent owns API/fixture persistence and schedule refetch after save.
 */
export function StopPlanEditor(props: StopPlanEditorProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [delayText, setDelayText] = useState("");
  const [athleteNotes, setAthleteNotes] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [athleteNoteId, setAthleteNoteId] = useState<string | undefined>();
  const [planNoteId, setPlanNoteId] = useState<string | undefined>();
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    if (props.loadingPlan) {
      return;
    }
    const plan = props.plan;
    setDelayText(
      typeof plan?.delayOverrideSeconds === "number" ? String(plan.delayOverrideSeconds) : ""
    );
    setAthleteNotes(plan?.athleteNotes?.body ?? "");
    setPlanNotes(plan?.planNotes?.body ?? "");
    setAthleteNoteId(plan?.athleteNotes?.id);
    setPlanNoteId(plan?.planNotes?.id);
    setLocalError(undefined);
  }, [props.plan, props.loadingPlan, props.checkpointId]);

  if (!props.canEdit) {
    return (
      <View style={styles.panel} accessibilityLabel="Stop plan read only">
        <Text style={styles.hint}>Only course editors can change stop delay and notes.</Text>
      </View>
    );
  }

  if (props.loadingPlan) {
    return (
      <View style={styles.panel} accessibilityLabel="Stop plan loading">
        <ActivityIndicator accessibilityLabel="Loading stop plan" color={theme.color.primary} />
      </View>
    );
  }

  const disabled = props.saving;

  const onSavePress = () => {
    setLocalError(undefined);
    const trimmed = delayText.trim();
    const input: UpsertStopPlanInput = {};

    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        setLocalError("Delay must be a non-negative whole number of seconds.");
        return;
      }
      input.delayOverrideSeconds = parsed;
    } else if (typeof props.plan?.delayOverrideSeconds === "number") {
      // Explicit empty field with existing delay → clear via null (PUT {} would not clear).
      input.delayOverrideSeconds = null;
    }

    input.athleteNotes =
      athleteNotes.trim().length > 0
        ? { id: athleteNoteId, body: athleteNotes }
        : props.plan?.athleteNotes
          ? null
          : undefined;
    input.planNotes =
      planNotes.trim().length > 0
        ? { id: planNoteId, body: planNotes }
        : props.plan?.planNotes
          ? null
          : undefined;

    // Avoid empty PUT {} when nothing changed meaningfully — still allow save of current values.
    if (
      input.delayOverrideSeconds === undefined &&
      input.athleteNotes === undefined &&
      input.planNotes === undefined
    ) {
      // Re-send current delay if present so duplicate save stays idempotent (EC5).
      if (typeof props.plan?.delayOverrideSeconds === "number") {
        input.delayOverrideSeconds = props.plan.delayOverrideSeconds;
      } else if (props.plan?.athleteNotes) {
        input.athleteNotes = { id: props.plan.athleteNotes.id, body: props.plan.athleteNotes.body };
      } else if (props.plan?.planNotes) {
        input.planNotes = { id: props.plan.planNotes.id, body: props.plan.planNotes.body };
      } else {
        setLocalError("Nothing to save. Set a delay or notes first.");
        return;
      }
    }

    props.onSave(input);
  };

  const errorText = localError ?? props.error;

  return (
    <View style={styles.panel} accessibilityLabel="Stop plan editor">
      <Text style={styles.label}>Delay override (seconds)</Text>
      <DSTextInput
        value={delayText}
        onChangeText={setDelayText}
        keyboardType="number-pad"
        editable={!disabled}
        accessibilityLabel="Stop delay seconds"
        placeholder="e.g. 120"
      />

      {errorText ? (
        <Text style={styles.error} accessibilityLabel="Stop plan error">
          {errorText}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={onSavePress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Save stop plan"
          style={[styles.primaryBtn, disabled ? styles.disabled : null]}
        >
          {props.saving ? (
            <ActivityIndicator accessibilityLabel="Saving stop plan" color={theme.color.onPrimary} />
          ) : (
            <Text style={styles.primaryLabel}>Save</Text>
          )}
        </Pressable>
        <Pressable
          onPress={props.onCancel}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Cancel stop plan edit"
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryLabel}>Cancel</Text>
        </Pressable>
      </View>

      <View style={styles.clearRow}>
        <Pressable
          onPress={props.onClearDelay}
          disabled={disabled || typeof props.plan?.delayOverrideSeconds !== "number"}
          accessibilityRole="button"
          accessibilityLabel="Clear stop delay"
          style={styles.clearBtn}
        >
          <Text style={styles.clearLabel}>Clear delay</Text>
        </Pressable>
        <Pressable
          onPress={props.onClearAthleteNotes}
          disabled={disabled || !props.plan?.athleteNotes}
          accessibilityRole="button"
          accessibilityLabel="Clear athlete notes"
          style={styles.clearBtn}
        >
          <Text style={styles.clearLabel}>Clear athlete notes</Text>
        </Pressable>
        <Pressable
          onPress={props.onClearPlanNotes}
          disabled={disabled || !props.plan?.planNotes}
          accessibilityRole="button"
          accessibilityLabel="Clear plan notes"
          style={styles.clearBtn}
        >
          <Text style={styles.clearLabel}>Clear plan notes</Text>
        </Pressable>
        <Pressable
          onPress={props.onClearAll}
          disabled={disabled || !hasAnyOverlay(props.plan)}
          accessibilityRole="button"
          accessibilityLabel="Clear stop plan"
          style={styles.clearBtn}
        >
          <Text style={styles.clearLabel}>Clear all</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>Athlete notes</Text>
      <DSTextInput
        value={athleteNotes}
        onChangeText={setAthleteNotes}
        editable={!disabled}
        multiline
        accessibilityLabel="Athlete notes"
        placeholder="Athlete-facing notes"
      />

      <Text style={styles.label}>Plan notes</Text>
      <DSTextInput
        value={planNotes}
        onChangeText={setPlanNotes}
        editable={!disabled}
        multiline
        accessibilityLabel="Plan notes"
        placeholder="Crew plan notes"
      />
    </View>
  );
}

function hasAnyOverlay(plan: StopPlanResponse | null): boolean {
  if (!plan) {
    return false;
  }
  return (
    typeof plan.delayOverrideSeconds === "number" ||
    Boolean(plan.athleteNotes) ||
    Boolean(plan.planNotes)
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    panel: {
      marginTop: 10,
      gap: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.divider
    },
    label: {
      color: theme.color.body,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 4
    },
    hint: {
      color: theme.color.body,
      lineHeight: 20
    },
    error: {
      color: theme.color.danger,
      lineHeight: 20
    },
    actions: {
      flexDirection: "row",
      gap: 10,
      marginTop: 8
    },
    primaryBtn: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center",
      minWidth: 96
    },
    primaryLabel: {
      color: theme.color.onPrimary,
      fontWeight: "700",
      textAlign: "center"
    },
    secondaryBtn: {
      backgroundColor: theme.color.secondaryButton,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center"
    },
    secondaryLabel: {
      color: theme.color.text,
      fontWeight: "600"
    },
    disabled: {
      opacity: 0.6
    },
    clearRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 4
    },
    clearBtn: {
      paddingVertical: 8,
      paddingHorizontal: 10
    },
    clearLabel: {
      color: theme.color.primary,
      fontWeight: "600",
      fontSize: 13
    }
  });
}
