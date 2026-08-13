import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { DSTextInput, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { ManualCheckpointStopInput } from "../../api/client";
import { validateClosedCheckIn } from "./checkInValidation";

export type CheckInEditorProps = {
  checkpointId: string;
  /** Prefill arrival (typically schedule clockArrivalAt). */
  defaultArrivalAt?: string;
  /** Prefill departure (typically arrival + planned dwell). */
  defaultDepartureAt?: string;
  saving: boolean;
  error?: string;
  canEdit: boolean;
  onSave: (input: ManualCheckpointStopInput) => void;
  onCancel: () => void;
};

/**
 * Inline closed check-in editor (arrival + departure).
 * Parent owns API/fixture persistence and schedule refetch after save.
 */
export function CheckInEditor(props: CheckInEditorProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [arrivalAt, setArrivalAt] = useState(props.defaultArrivalAt ?? "");
  const [departureAt, setDepartureAt] = useState(props.defaultDepartureAt ?? "");
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    setArrivalAt(props.defaultArrivalAt ?? "");
    setDepartureAt(props.defaultDepartureAt ?? "");
    setLocalError(undefined);
  }, [props.checkpointId, props.defaultArrivalAt, props.defaultDepartureAt]);

  if (!props.canEdit) {
    return (
      <View style={styles.panel} accessibilityLabel="Check-in read only">
        <Text style={styles.hint}>Only crew stop editors can submit check-in times.</Text>
      </View>
    );
  }

  const disabled = props.saving;
  const displayError = localError ?? props.error;

  const onSavePress = () => {
    setLocalError(undefined);
    const validated = validateClosedCheckIn({ arrivalAt, departureAt });
    if (!validated.ok) {
      setLocalError(validated.message);
      return;
    }
    props.onSave(validated.input);
  };

  return (
    <View style={styles.panel} accessibilityLabel="Check-in editor">
      <Text style={styles.title}>Closed check-in</Text>
      <Text style={styles.hint}>
        Both arrival and departure are required. Later schedule clocks refresh from the server after
        save.
      </Text>

      {displayError ? (
        <Text style={styles.error} accessibilityLabel="Check-in error">
          {displayError}
        </Text>
      ) : null}

      <Text style={styles.label}>Arrival</Text>
      <DSTextInput
        value={arrivalAt}
        onChangeText={setArrivalAt}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Check in arrival"
        placeholder="2026-08-15T14:10:00.000Z"
      />

      <Text style={styles.label}>Departure</Text>
      <DSTextInput
        value={departureAt}
        onChangeText={setDepartureAt}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Check in departure"
        placeholder="2026-08-15T14:20:00.000Z"
      />

      <View style={styles.actions}>
        <Pressable
          onPress={onSavePress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Save check-in"
          style={[styles.primaryBtn, disabled ? styles.disabled : null]}
        >
          {props.saving ? (
            <ActivityIndicator accessibilityLabel="Saving check-in" color={theme.color.onPrimary} />
          ) : (
            <Text style={styles.primaryLabel}>Save check-in</Text>
          )}
        </Pressable>
        <Pressable
          onPress={props.onCancel}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Cancel check-in"
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryLabel}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    panel: {
      marginTop: 10,
      gap: 8
    },
    title: {
      color: theme.color.text,
      fontWeight: "700",
      fontSize: 15
    },
    hint: {
      color: theme.color.body,
      fontSize: 13,
      lineHeight: 18
    },
    label: {
      color: theme.color.body,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 4
    },
    error: {
      color: theme.color.danger,
      fontSize: 13,
      lineHeight: 18
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
      marginTop: 8
    },
    primaryBtn: {
      backgroundColor: theme.color.primary,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center",
      alignItems: "center"
    },
    primaryLabel: {
      color: theme.color.onPrimary,
      fontWeight: "700"
    },
    secondaryBtn: {
      minHeight: theme.spacing.touchTargetMin,
      justifyContent: "center",
      paddingHorizontal: 8
    },
    secondaryLabel: {
      color: theme.color.primary,
      fontWeight: "700"
    },
    disabled: {
      opacity: 0.55
    }
  });
}
