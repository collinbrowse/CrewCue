import { useMemo, type ReactElement } from "react";
import { StyleSheet, Text, View, type DimensionValue } from "react-native";
import { useDSTheme, type DSThemeTokens } from "../../design-system";

export type CourseImportProgressBarProps = {
  /** 0..1 */
  ratio: number;
  message: string;
  fileName?: string;
};

/**
 * Determinate bar shown after a course GPX/KML/JSON is selected while splits are computed.
 */
export function CourseImportProgressBar(props: CourseImportProgressBarProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const ratio = Math.max(0, Math.min(1, props.ratio));
  const percentLabel = `${Math.round(ratio * 100)}%`;
  const widthPercent = `${Math.round(ratio * 1000) / 10}%` as DimensionValue;

  return (
    <View
      style={styles.block}
      accessibilityLabel="Course import progress"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100), text: percentLabel }}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: widthPercent }]} />
      </View>
      <Text style={styles.message} accessibilityLabel="Course import status">
        {props.message}
      </Text>
      {props.fileName ? (
        <Text style={styles.fileName} accessibilityLabel="Course import file name">
          {props.fileName}
        </Text>
      ) : null}
      <Text style={styles.percent} accessibilityLabel="Course import percent">
        {percentLabel}
      </Text>
    </View>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    block: {
      gap: 8,
      marginTop: 12
    },
    track: {
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.color.border,
      overflow: "hidden"
    },
    fill: {
      height: "100%",
      borderRadius: 4,
      backgroundColor: theme.color.primary
    },
    message: {
      color: theme.color.text,
      fontSize: 14,
      fontWeight: "500",
      lineHeight: 20
    },
    fileName: {
      color: theme.color.body,
      fontSize: 13
    },
    percent: {
      color: theme.color.body,
      fontSize: 13,
      fontWeight: "600"
    }
  });
}
