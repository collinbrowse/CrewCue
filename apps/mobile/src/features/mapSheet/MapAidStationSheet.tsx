import { Ionicons } from "@expo/vector-icons";
import type { CrewScheduleSheet, PacingEstimate } from "@crewcue/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderHandlers,
  type LayoutChangeEvent
} from "react-native";
import type { ManualCheckpointStopInput, StopPlanResponse, UpsertStopPlanInput } from "../../api/client";
import { useDSTheme, type DSThemeTokens } from "../../design-system";
import type { CrewSheetNoteBodies } from "../schedule/crewSheetExport";
import { ScheduleSheetChrome } from "../schedule/ScheduleSheetChrome";
import { ScheduleStopCard } from "../schedule/ScheduleStopCard";
import {
  peekArrival,
  peekKicker,
  peekStationStats,
  projectionEtaFallbackForPage,
  type AidStationPage,
  type MapSheetPhase
} from "./aidStationPagerModel";

export type MapAidStationIndexSource = "pager" | "chevron" | "marker" | "jump" | "follow";

export type MapAidStationSheetProps = {
  handlePanHandlers: GestureResponderHandlers;
  onCycleSheet: () => void;
  onPeekChromeHeight: (height: number) => void;
  expanded: boolean;
  collapseLocked: boolean;
  insetsBottom: number;
  pages: AidStationPage[];
  index: number;
  follow: boolean;
  liveNextIndex: number | null;
  liveNextTitle: string;
  onIndexChange: (index: number, source: MapAidStationIndexSource) => void;
  phase: MapSheetPhase;
  emptyMessage?: string;
  runnerCaption?: string;
  progressMeters: number;
  paceSecondsPerKm?: number;
  nowMs?: number;
  sheet: CrewScheduleSheet | null;
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  titleByCheckpointId: Map<string, string>;
  canEditStopPlans?: boolean;
  editingCheckpointId?: string | null;
  onEditStop?: (checkpointId: string) => void;
  onCancelEdit?: () => void;
  editingPlan?: StopPlanResponse | null;
  loadingPlan?: boolean;
  savingPlan?: boolean;
  saveError?: string;
  actionError?: string;
  onSaveStopPlan?: (checkpointId: string, input: UpsertStopPlanInput) => void;
  onClearStopDelay?: (checkpointId: string) => void;
  onClearAthleteNotes?: (checkpointId: string) => void;
  onClearPlanNotes?: (checkpointId: string) => void;
  onClearStopPlan?: (checkpointId: string) => void;
  canEditCheckIn?: boolean;
  checkInCheckpointId?: string | null;
  onOpenCheckIn?: (checkpointId: string) => void;
  onCancelCheckIn?: () => void;
  savingCheckIn?: boolean;
  checkInError?: string;
  onSaveCheckIn?: (checkpointId: string, input: ManualCheckpointStopInput) => void;
  pacingEstimate?: PacingEstimate | null;
  addingHistory?: boolean;
  onAddHistory?: () => void;
  estimateError?: string;
  onRecalculateFromHistory?: () => void;
  recalculating?: boolean;
  noteBodiesByCheckpointId?: ReadonlyMap<string, CrewSheetNoteBodies>;
  showCrewSheetExport?: boolean;
};

export function MapAidStationSheet(props: MapAidStationSheetProps): ReactElement {
  const theme = useDSTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const pagerRef = useRef<ScrollView>(null);
  const innerScrollRefs = useRef<Array<ScrollView | null>>([]);
  const scrollX = useRef(new Animated.Value(0)).current;
  const draggingRef = useRef(false);
  const [pageWidth, setPageWidth] = useState(0);
  const [clockMs, setClockMs] = useState(() => props.nowMs ?? Date.now());
  const peekParts = useRef({ handle: 0, sticky: 0, peek: 0 });

  useEffect(() => {
    if (props.nowMs != null) {
      setClockMs(props.nowMs);
      return undefined;
    }
    const id = setInterval(() => setClockMs(Date.now()), 15000);
    return () => clearInterval(id);
  }, [props.nowMs]);

  const reportPeek = useCallback(() => {
    const h = peekParts.current.handle + peekParts.current.sticky + peekParts.current.peek;
    if (h > 0) {
      props.onPeekChromeHeight(h);
    }
  }, [props]);

  const onHandleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      peekParts.current.handle = Math.round(e.nativeEvent.layout.height);
      reportPeek();
    },
    [reportPeek]
  );
  const onStickyLayout = useCallback(
    (e: LayoutChangeEvent) => {
      peekParts.current.sticky = Math.round(e.nativeEvent.layout.height);
      reportPeek();
    },
    [reportPeek]
  );
  const onPeekPageLayout = useCallback(
    (e: LayoutChangeEvent) => {
      peekParts.current.peek = Math.round(e.nativeEvent.layout.height);
      reportPeek();
    },
    [reportPeek]
  );

  const onPagerLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0) {
      setPageWidth((prev) => (prev === w ? prev : w));
    }
  }, []);

  useEffect(() => {
    if (pageWidth <= 0 || draggingRef.current) {
      return;
    }
    pagerRef.current?.scrollTo({ x: props.index * pageWidth, animated: true });
  }, [props.index, pageWidth]);

  useEffect(() => {
    if (!props.expanded) {
      innerScrollRefs.current[props.index]?.scrollTo({ y: 0, animated: false });
    }
  }, [props.expanded, props.index]);

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      draggingRef.current = false;
      if (pageWidth <= 0) {
        return;
      }
      const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
      if (next !== props.index) {
        props.onIndexChange(next, "pager");
      }
    },
    [pageWidth, props]
  );

  const pageCount = props.pages.length;
  const canPage = pageCount > 1 && !props.collapseLocked;

  const jumpVisible =
    !props.follow &&
    props.liveNextIndex != null &&
    props.liveNextIndex !== props.index &&
    pageCount > 0;

  const renderPeekChrome = (page: AidStationPage, measure: boolean): ReactElement => {
    const fallback = projectionEtaFallbackForPage({
      distanceMetersFromStart: page.distanceMetersFromStart,
      progressMeters: props.progressMeters,
      paceSecondsPerKm: props.paceSecondsPerKm,
      nowMs: clockMs
    });
    const arrival = peekArrival({ stop: page.stop, nowMs: clockMs, fallback });
    const stats = peekStationStats({
      progressMeters: props.progressMeters,
      distanceMetersFromStart: page.distanceMetersFromStart,
      plannedStoppageSeconds: page.plannedStoppageSeconds,
      delayOverrideSeconds: page.stop?.delayOverrideSeconds
    });
    const kicker = peekKicker({
      phase: props.phase,
      pageIndex: page.index,
      pageCount,
      liveNextIndex: props.liveNextIndex
    });
    return (
      <View onLayout={measure ? onPeekPageLayout : undefined} style={styles.peekPage}>
        <View style={styles.peekTitleRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.sheetKicker}>{kicker}</Text>
            <Text style={styles.peekTitle} numberOfLines={2}>
              {page.title}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.peekClock}>{arrival.clockLabel}</Text>
            <Text style={styles.peekClockHint}>EST. ARRIVAL</Text>
            <View style={styles.etaPill}>
              <Text style={styles.etaPillText}>{arrival.remainLabel}</Text>
            </View>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>DISTANCE</Text>
            <Text style={styles.statValue}>{stats.distanceLabel}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>STOP</Text>
            <Text style={styles.statValue}>{stats.stoppageLabel}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statLabel}>DELAY</Text>
            <Text style={styles.statValue}>{stats.delayLabel ?? "—"}</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderChrome = (): ReactElement | null =>
    props.sheet && pageCount > 0 ? (
      <ScheduleSheetChrome
        sheet={props.sheet}
        titleByCheckpointId={props.titleByCheckpointId}
        canEditStopPlans={props.canEditStopPlans}
        canEditCheckIn={props.canEditCheckIn}
        actionError={props.actionError}
        pacingEstimate={props.pacingEstimate}
        addingHistory={props.addingHistory}
        onAddHistory={props.onAddHistory}
        estimateError={props.estimateError}
        onRecalculateFromHistory={props.onRecalculateFromHistory}
        recalculating={props.recalculating}
        noteBodiesByCheckpointId={props.noteBodiesByCheckpointId}
        showCrewSheetExport={props.showCrewSheetExport}
        compact
      />
    ) : null;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      enabled={props.expanded && props.collapseLocked}
    >
      <View onLayout={onHandleLayout} {...props.handlePanHandlers}>
        <Pressable
          onPress={props.collapseLocked ? undefined : props.onCycleSheet}
          accessibilityRole="button"
          accessibilityLabel={props.expanded ? "Collapse sheet" : "Expand sheet"}
        >
          <View style={styles.handle} />
        </Pressable>
      </View>

      {pageCount === 0 ? (
        <View style={styles.emptyPeek} onLayout={onStickyLayout}>
          {props.loading ? (
            <ActivityIndicator accessibilityLabel="Loading schedule" color={theme.color.primary} />
          ) : null}
          <Text style={styles.emptyCopy} accessibilityLabel="Aid station empty">
            {props.error
              ? props.error
              : props.emptyMessage ?? "Upload a course to see aid stations."}
          </Text>
          {props.error && props.onRetry ? (
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
      ) : (
        <>
          <View onLayout={onStickyLayout} style={styles.sticky}>
            <View style={styles.chevronRow}>
              <Pressable
                onPress={() => props.onIndexChange(props.index - 1, "chevron")}
                disabled={props.index <= 0 || props.collapseLocked}
                accessibilityRole="button"
                accessibilityLabel="Previous aid"
                accessibilityState={{ disabled: props.index <= 0 || props.collapseLocked }}
                style={styles.chevronHit}
              >
                <Ionicons
                  name="chevron-back"
                  size={22}
                  color={props.index <= 0 || props.collapseLocked ? theme.color.muted : theme.color.text}
                />
              </Pressable>
              <Text style={styles.pageIndex} accessibilityLabel={`Aid ${props.index + 1} of ${pageCount}`}>
                {props.index + 1} of {pageCount}
              </Text>
              <Pressable
                onPress={() => props.onIndexChange(props.index + 1, "chevron")}
                disabled={props.index >= pageCount - 1 || props.collapseLocked}
                accessibilityRole="button"
                accessibilityLabel="Next aid"
                accessibilityState={{ disabled: props.index >= pageCount - 1 || props.collapseLocked }}
                style={styles.chevronHit}
              >
                <Ionicons
                  name="chevron-forward"
                  size={22}
                  color={
                    props.index >= pageCount - 1 || props.collapseLocked ? theme.color.muted : theme.color.text
                  }
                />
              </Pressable>
            </View>
            {pageCount <= 12 && pageWidth > 0 ? (
              <View style={styles.dots} accessibilityElementsHidden>
                {props.pages.map((page) => {
                  const i = page.index;
                  const opacity = scrollX.interpolate({
                    inputRange: [(i - 1) * pageWidth, i * pageWidth, (i + 1) * pageWidth],
                    outputRange: [0.28, 1, 0.28],
                    extrapolate: "clamp"
                  });
                  return <Animated.View key={page.checkpointId} style={[styles.dot, { opacity }]} />;
                })}
              </View>
            ) : null}
            {jumpVisible ? (
              <Pressable
                onPress={() => props.onIndexChange(props.liveNextIndex!, "jump")}
                accessibilityRole="button"
                accessibilityLabel={`Jump to next ${props.liveNextTitle}`}
                style={styles.jumpBtn}
              >
                <Text style={styles.jumpLabel}>Athlete next: {props.liveNextTitle}</Text>
              </Pressable>
            ) : null}
            {props.runnerCaption ? (
              <Text style={styles.caption} numberOfLines={1}>
                {props.runnerCaption}
              </Text>
            ) : null}
          </View>

          <Animated.ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            directionalLockEnabled
            decelerationRate="fast"
            disableIntervalMomentum
            showsHorizontalScrollIndicator={false}
            scrollEnabled={canPage}
            keyboardShouldPersistTaps="handled"
            onLayout={onPagerLayout}
            onScrollBeginDrag={() => {
              draggingRef.current = true;
            }}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
              useNativeDriver: true
            })}
            scrollEventThrottle={16}
            accessibilityLabel="Aid station pager"
            style={styles.pager}
          >
            {props.pages.map((page, pageIdx) => (
              <View key={page.checkpointId} style={{ width: pageWidth || 1 }}>
                {renderPeekChrome(page, pageIdx === props.index || pageIdx === 0)}
                <ScrollView
                  ref={(node) => {
                    innerScrollRefs.current[pageIdx] = node;
                  }}
                  style={styles.details}
                  contentContainerStyle={{ paddingBottom: 16 + props.insetsBottom, gap: 10 }}
                  scrollEnabled={props.expanded}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {props.error ? (
                    <View>
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
                  ) : null}
                  <View accessibilityElementsHidden={pageIdx !== props.index}>
                    {renderChrome()}
                  </View>
                  {page.stop ? (
                    <ScheduleStopCard
                      stop={page.stop}
                      title={page.title}
                      displayIndex={page.index + 1}
                      canEditStopPlans={props.canEditStopPlans}
                      canEditCheckIn={props.canEditCheckIn}
                      editingCheckpointId={props.editingCheckpointId}
                      onEditStop={props.onEditStop}
                      onCancelEdit={props.onCancelEdit}
                      editingPlan={props.editingPlan}
                      loadingPlan={props.loadingPlan}
                      savingPlan={props.savingPlan}
                      saveError={props.saveError}
                      onSaveStopPlan={props.onSaveStopPlan}
                      onClearStopDelay={props.onClearStopDelay}
                      onClearAthleteNotes={props.onClearAthleteNotes}
                      onClearPlanNotes={props.onClearPlanNotes}
                      onClearStopPlan={props.onClearStopPlan}
                      checkInCheckpointId={props.checkInCheckpointId}
                      onOpenCheckIn={props.onOpenCheckIn}
                      onCancelCheckIn={props.onCancelCheckIn}
                      savingCheckIn={props.savingCheckIn}
                      checkInError={props.checkInError}
                      onSaveCheckIn={props.onSaveCheckIn}
                    />
                  ) : (
                    <Text style={styles.emptyCopy}>
                      {props.loading ? "Loading crew details…" : "Crew details load with the schedule."}
                    </Text>
                  )}
                </ScrollView>
              </View>
            ))}
          </Animated.ScrollView>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

function createStyles(theme: DSThemeTokens) {
  return StyleSheet.create({
    root: { flex: 1, overflow: "hidden" },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.color.muted,
      marginTop: 8,
      marginBottom: 10
    },
    sticky: {
      paddingHorizontal: 16,
      paddingBottom: 4,
      flexShrink: 0
    },
    chevronRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between"
    },
    chevronHit: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center"
    },
    pageIndex: {
      color: theme.color.muted,
      fontSize: 12,
      fontWeight: "700"
    },
    dots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 6,
      marginTop: 2,
      marginBottom: 4
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.color.text
    },
    jumpBtn: {
      alignSelf: "flex-start",
      marginTop: 4,
      marginBottom: 4,
      backgroundColor: theme.color.secondaryButton,
      borderRadius: 999,
      paddingHorizontal: 12,
      minHeight: 36,
      justifyContent: "center"
    },
    jumpLabel: {
      color: theme.color.text,
      fontWeight: "700",
      fontSize: 12
    },
    caption: {
      color: theme.color.muted,
      fontSize: 13,
      marginTop: 4
    },
    pager: { flex: 1 },
    peekPage: {
      paddingHorizontal: 16,
      paddingTop: 4,
      paddingBottom: 8
    },
    peekTitleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start"
    },
    sheetKicker: { fontSize: 11, fontWeight: "700", color: theme.color.muted },
    peekTitle: { color: theme.color.text, fontSize: 20, fontWeight: "800", marginTop: 4 },
    peekClock: { color: theme.color.text, fontSize: 22, fontWeight: "800" },
    peekClockHint: { color: theme.color.muted, fontSize: 11, marginTop: 2 },
    etaPill: {
      marginTop: 6,
      backgroundColor: theme.color.secondaryButton,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border
    },
    etaPillText: { color: theme.color.text, fontWeight: "800", fontSize: 12 },
    statsRow: {
      flexDirection: "row",
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.divider,
      paddingTop: 12
    },
    statCol: { flex: 1, alignItems: "center" },
    statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: theme.color.divider },
    statLabel: { fontSize: 11, color: theme.color.muted, marginBottom: 4 },
    statValue: { fontSize: 16, fontWeight: "800", color: theme.color.text },
    details: { flex: 1, paddingHorizontal: 16 },
    emptyPeek: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    emptyCopy: { color: theme.color.muted, lineHeight: 20 },
    errorText: { color: theme.color.danger, lineHeight: 20, marginBottom: 8 },
    retryButton: {
      alignSelf: "flex-start",
      backgroundColor: theme.color.secondaryButton,
      borderRadius: theme.radius.md,
      minHeight: theme.spacing.touchTargetMin,
      paddingHorizontal: 16,
      justifyContent: "center"
    },
    retryLabel: { color: theme.color.text, fontWeight: "700" }
  });
}
