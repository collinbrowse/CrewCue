import { useMemo, type ReactElement } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { DSButton, DSCard, useDSTheme, type DSThemeTokens } from "../../design-system";
import type { ActivityHistoryUploadState } from "./useActivityHistoryUpload";

export type ActivityHistoryUploadCardProps = {
  upload: ActivityHistoryUploadState;
  /** When false, hide actions (no API client / not signed in). */
  enabled?: boolean;
};

/**
 * Profile surface for uploading past-run GPX into shared activity history (same store as Strava).
 */
export function ActivityHistoryUploadCard(props: ActivityHistoryUploadCardProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { upload } = props;
  const enabled = props.enabled !== false;
  const showProgress = upload.busy && Boolean(upload.progressMessage);
  const ratio = Math.max(0, Math.min(1, upload.progressRatio ?? 0));
  const percentLabel = `${Math.round(ratio * 100)}%`;

  return (
    <View accessibilityLabel="Activity GPX upload">
      <DSCard style={styles.card}>
        <Text style={styles.title} accessibilityLabel="Activity GPX upload title">
          Upload activity GPX
        </Text>
        <Text style={styles.body} accessibilityLabel="Activity GPX upload explanation">
          Add past runs as GPX files (with track timestamps) to tighten pacing estimates. Files are
          parsed on this device; only distance/time metrics are sent — same history store as Strava.
        </Text>
        {upload.loading && !upload.busy ? (
          <ActivityIndicator accessibilityLabel="Loading activity history" color={theme.color.text} />
        ) : (
          <Text style={styles.status} accessibilityLabel="Activity history count">
            {upload.historyCount === 0
              ? "No activity history yet"
              : `${upload.historyCount} activit${upload.historyCount === 1 ? "y" : "ies"} in history`}
          </Text>
        )}
        {showProgress ? (
          <View
            style={styles.progressBlock}
            accessibilityLabel="Activity GPX upload progress"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100), text: percentLabel }}
          >
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(ratio * 1000) / 10}%` }]} />
            </View>
            <Text style={styles.progress} accessibilityLabel="Activity GPX upload status">
              {upload.progressMessage} · {percentLabel}
            </Text>
          </View>
        ) : null}
        {!showProgress && upload.lastMessage ? (
          <Text style={styles.meta} accessibilityLabel="Activity GPX upload result">
            {upload.lastMessage}
          </Text>
        ) : null}
        {!showProgress && upload.error ? (
          <Text style={styles.error} accessibilityLabel="Activity GPX upload error">
            {upload.error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <DSButton
            preset="primary"
            onPress={() => void upload.uploadGpxFiles()}
            disabled={!enabled || upload.busy || upload.loading}
          >
            {upload.busy ? (upload.progressMessage ? "Working…" : "Choose files…") : "Choose GPX files"}
          </DSButton>
        </View>
      </DSCard>
    </View>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    card: {
      gap: 8
    },
    title: {
      color: theme.color.text,
      fontSize: 17,
      fontWeight: "600"
    },
    body: {
      color: theme.color.body,
      fontSize: 14,
      lineHeight: 20
    },
    status: {
      color: theme.color.text,
      fontSize: 14,
      fontWeight: "500"
    },
    progressBlock: {
      gap: 8,
      marginTop: 2
    },
    progressTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.color.border,
      overflow: "hidden"
    },
    progressFill: {
      height: "100%",
      borderRadius: 4,
      backgroundColor: theme.color.primary
    },
    progress: {
      color: theme.color.text,
      fontSize: 14,
      fontWeight: "500",
      lineHeight: 20
    },
    meta: {
      color: theme.color.body,
      fontSize: 13
    },
    error: {
      color: theme.color.danger,
      fontSize: 13
    },
    actions: {
      gap: 8,
      marginTop: 4
    }
  });
}
