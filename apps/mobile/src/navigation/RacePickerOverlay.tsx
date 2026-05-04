import type { ReactElement } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RaceRoom } from "@crewcue/contracts";
import { DSButton } from "../design-system";

export type RacePickerPanelLayout = { left: number; width: number; top: number };

/** Window rect for the header race title (same coords as `measureInWindow`). */
export type RacePickerTitleHitRect = { x: number; y: number; width: number; height: number };

export type RacePickerBuckets = {
  current: RaceRoom[];
  upcoming: RaceRoom[];
  past: RaceRoom[];
};

type RacePickerOverlayProps = {
  visible: boolean;
  panelLayout: RacePickerPanelLayout;
  /** When set, taps on this rect close the picker (modal layer; native header often does not receive taps). */
  titleHitRect: RacePickerTitleHitRect | null;
  maxSheetHeight: number;
  scrollMaxHeight: number;
  selectedRace?: RaceRoom | null;
  buckets: RacePickerBuckets;
  onClose: () => void;
  onSelectRoom: (room: RaceRoom) => void;
};

export function RacePickerOverlay({
  visible,
  panelLayout,
  titleHitRect,
  maxSheetHeight,
  scrollMaxHeight,
  selectedRace,
  buckets,
  onClose,
  onSelectRoom
}: RacePickerOverlayProps): ReactElement {
  const sectionLabelStyle = styles.sectionLabel;
  const rowLabelStyle = styles.rowLabel;
  const pastRowLabelStyle = [styles.rowLabel, styles.pastRowLabel];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss race picker"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 1,
            backgroundColor: "rgba(17,24,39,0.52)"
          }}
          onPress={onClose}
        />
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { zIndex: 2, elevation: 12 }]}>
          <View style={styles.centerWrap}>
            <View
              style={{
                width: panelLayout.width,
                maxHeight: maxSheetHeight,
                zIndex: 3,
                elevation: 16,
                overflow: "hidden",
                backgroundColor: "#f7f2e9",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#d8d1c4",
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: 8,
                ...(Platform.OS === "ios"
                  ? {}
                  : {
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.35,
                      shadowRadius: 12
                    })
              }}
            >
              <View style={{ marginBottom: 8 }}>
                <Text style={styles.title}>Switch race</Text>
                <Text style={styles.subtitle}>Tap a race to open it.</Text>
                {selectedRace ? (
                  <Text style={styles.currentRace} numberOfLines={1}>
                    Current: {selectedRace.name}
                  </Text>
                ) : null}
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
                style={{ maxHeight: scrollMaxHeight }}
                contentContainerStyle={{ paddingBottom: 6 }}
              >
                {buckets.current.length > 0 ? (
                  <>
                    <Text style={sectionLabelStyle}>
                      Current races
                    </Text>
                    {buckets.current.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={styles.row}
                      >
                        <Text style={rowLabelStyle}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {buckets.upcoming.length > 0 ? (
                  <>
                    <Text style={[sectionLabelStyle, { marginTop: 6 }]}>
                      Upcoming races
                    </Text>
                    {buckets.upcoming.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={styles.row}
                      >
                        <Text style={rowLabelStyle}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {buckets.past.length > 0 ? (
                  <>
                    <Text style={[sectionLabelStyle, styles.pastSectionLabel, { marginTop: 6 }]}>
                      Past races
                    </Text>
                    {buckets.past.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={[styles.row, styles.pastRow]}
                      >
                        <Text style={pastRowLabelStyle}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
              </ScrollView>
              <View
                style={{
                  marginTop: 8,
                  paddingTop: 10,
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: "#d8d1c4"
                }}
              >
                <DSButton preset="authSecondary" onPress={onClose}>
                  Close
                </DSButton>
              </View>
            </View>
          </View>
          {titleHitRect ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close race picker"
              onPress={onClose}
              style={{
                position: "absolute",
                left: titleHitRect.x,
                top: titleHitRect.y,
                width: titleHitRect.width,
                height: titleHitRect.height,
                zIndex: 20
              }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12
  },
  title: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "800"
  },
  subtitle: {
    color: "#5c5a54",
    marginTop: 2,
    fontSize: 13
  },
  currentRace: {
    color: "#6B46C1",
    fontWeight: "600",
    fontSize: 13,
    marginTop: 6
  },
  sectionLabel: {
    color: "#6B46C1",
    fontSize: 11,
    textTransform: "uppercase",
    marginBottom: 6,
    fontWeight: "700"
  },
  pastSectionLabel: {
    color: "#7a756c"
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#d8d1c4",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginBottom: 6
  },
  pastRow: {
    backgroundColor: "#f3efe6"
  },
  rowLabel: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "600"
  },
  pastRowLabel: {
    color: "#5c5a54",
    fontWeight: "500"
  }
});
