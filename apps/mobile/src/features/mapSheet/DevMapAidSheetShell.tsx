import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDSTheme } from "../../design-system";
import { MapAidStationSheet, type MapAidStationSheetProps } from "./MapAidStationSheet";

type ShellProps = Omit<
  MapAidStationSheetProps,
  "handlePanHandlers" | "onCycleSheet" | "onPeekChromeHeight" | "expanded" | "insetsBottom"
> & {
  initialExpanded?: boolean;
};

/**
 * Full-screen host for MapAidStationSheet without a map (DEV fixtures).
 * Starts expanded so Auth0-free QA can reach editors immediately; handle still toggles peek.
 */
export function DevMapAidSheetShell(props: ShellProps): ReactElement {
  const { initialExpanded = true, ...sheetProps } = props;
  const theme = useDSTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(initialExpanded);
  const [peekPx, setPeekPx] = useState(220);

  useEffect(() => {
    if (sheetProps.collapseLocked) {
      setExpanded(true);
    }
  }, [sheetProps.collapseLocked]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
        onPanResponderRelease: (_, g) => {
          if (sheetProps.collapseLocked) {
            return;
          }
          if (Math.abs(g.dy) < 12 && Math.abs(g.vy) < 0.3) {
            return;
          }
          const next = g.dy > 0 || g.vy > 0.4 ? false : true;
          setExpanded(next);
        }
      }),
    [sheetProps.collapseLocked]
  );

  const onCycleSheet = useCallback(() => {
    if (sheetProps.collapseLocked) {
      return;
    }
    setExpanded((v) => !v);
  }, [sheetProps.collapseLocked]);

  return (
    <View style={[styles.root, { backgroundColor: theme.color.background }]} accessibilityLabel="Dev map aid sheet">
      <View style={[styles.mapStub, { backgroundColor: theme.color.secondaryButton }]} />
      <View
        style={[
          styles.sheet,
          {
            height: expanded ? undefined : peekPx,
            top: expanded ? 120 : undefined,
            bottom: 0,
            backgroundColor: theme.color.card,
            borderColor: theme.color.border
          }
        ]}
      >
        <MapAidStationSheet
          {...sheetProps}
          handlePanHandlers={panResponder.panHandlers}
          onCycleSheet={onCycleSheet}
          onPeekChromeHeight={(h) => setPeekPx(Math.max(160, h))}
          expanded={expanded}
          insetsBottom={insets.bottom}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapStub: { ...StyleSheet.absoluteFillObject },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden"
  }
});
