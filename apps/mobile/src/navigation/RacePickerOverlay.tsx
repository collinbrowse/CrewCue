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
  headerBottomY: number;
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
  headerBottomY,
  panelLayout,
  titleHitRect,
  maxSheetHeight,
  scrollMaxHeight,
  selectedRace,
  buckets,
  onClose,
  onSelectRoom
}: RacePickerOverlayProps): ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFillObject}>
        <View style={{ height: headerBottomY }} pointerEvents="none" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss race picker"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: headerBottomY,
            bottom: 0,
            zIndex: 1,
            backgroundColor: "rgba(3,7,18,0.55)"
          }}
          onPress={onClose}
        />
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { zIndex: 2, elevation: 12 }]}>
          <View
            style={{
              position: "absolute",
              left: panelLayout.left,
              width: panelLayout.width,
              top: panelLayout.top,
              maxHeight: maxSheetHeight,
              zIndex: 3,
              elevation: 16,
              overflow: "hidden",
              backgroundColor: "#0b1220",
              borderBottomLeftRadius: 14,
              borderBottomRightRadius: 14,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderBottomWidth: 1,
              borderColor: "#1e40af",
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
                <Text style={{ color: "#f8fafc", fontSize: 16, fontWeight: "800" }}>Switch race</Text>
                <Text style={{ color: "#93c5fd", marginTop: 2, fontSize: 13 }}>Tap a race to open it.</Text>
                {selectedRace ? (
                  <Text style={{ color: "#86efac", fontWeight: "600", fontSize: 13, marginTop: 6 }} numberOfLines={1}>
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
                    <Text style={{ color: "#93c5fd", fontSize: 11, textTransform: "uppercase", marginBottom: 6 }}>
                      Current races
                    </Text>
                    {buckets.current.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: "#1f2937",
                          backgroundColor: "#111827",
                          borderRadius: 8,
                          marginBottom: 6
                        }}
                      >
                        <Text style={{ color: "#e5e7eb", fontSize: 15, fontWeight: "600" }}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {buckets.upcoming.length > 0 ? (
                  <>
                    <Text style={{ color: "#93c5fd", fontSize: 11, textTransform: "uppercase", marginTop: 6, marginBottom: 6 }}>
                      Upcoming races
                    </Text>
                    {buckets.upcoming.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: "#1f2937",
                          backgroundColor: "#111827",
                          borderRadius: 8,
                          marginBottom: 6
                        }}
                      >
                        <Text style={{ color: "#e5e7eb", fontSize: 15, fontWeight: "600" }}>{room.name}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : null}
                {buckets.past.length > 0 ? (
                  <>
                    <Text style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", marginTop: 6, marginBottom: 6 }}>
                      Past races
                    </Text>
                    {buckets.past.map((room) => (
                      <Pressable
                        key={room.id}
                        onPress={() => {
                          void onSelectRoom(room);
                        }}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: "#1f2937",
                          backgroundColor: "#0f172a",
                          borderRadius: 8,
                          marginBottom: 6
                        }}
                      >
                        <Text style={{ color: "#cbd5e1", fontSize: 15 }}>{room.name}</Text>
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
                  borderTopColor: "#334155"
                }}
              >
                <DSButton preset="secondary" onPress={onClose}>
                  Close
                </DSButton>
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
