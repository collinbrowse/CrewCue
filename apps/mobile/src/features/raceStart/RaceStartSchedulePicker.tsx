import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as Localization from "expo-localization";
import { DateTime } from "luxon";
import { DSButton, DSTextInput, useDSTheme } from "../../design-system";
import { formatRaceStartSummary, listIanaTimeZones } from "./raceStartSchedule";

export type RaceStartSchedulePickerProps = {
  valueIso: string;
  onChange: (isoUtc: string) => void;
  disabled?: boolean;
};

export function RaceStartSchedulePicker(props: RaceStartSchedulePickerProps): ReactElement {
  const theme = useDSTheme();
  const { valueIso, onChange, disabled } = props;

  const deviceLocale = Localization.getLocales()[0]?.languageTag ?? "en-US";

  const [timeZoneId, setTimeZoneId] = useState(() => Localization.getCalendars()[0]?.timeZone ?? "UTC");
  const [pickMode, setPickMode] = useState<"date" | "time" | null>(null);
  const [tzModalOpen, setTzModalOpen] = useState(false);
  const [tzQuery, setTzQuery] = useState("");

  const instant = useMemo(() => {
    const dt = DateTime.fromISO(valueIso.trim(), { setZone: true });
    return dt.isValid ? dt : DateTime.now();
  }, [valueIso]);

  const valueAsDate = useMemo(() => instant.toJSDate(), [instant]);

  const [iosDraftDate, setIosDraftDate] = useState(() => valueAsDate);
  useEffect(() => {
    if (Platform.OS === "ios" && pickMode) {
      setIosDraftDate(valueAsDate);
    }
  }, [pickMode, valueAsDate]);

  const summary = useMemo(
    () => formatRaceStartSummary(instant.toUTC().toISO() ?? valueIso, deviceLocale, timeZoneId),
    [deviceLocale, instant, timeZoneId, valueIso]
  );

  const applyPickerDate = useCallback(
    (date: Date) => {
      const iso = DateTime.fromJSDate(date).toUTC().toISO();
      if (iso) {
        onChange(iso);
      }
    },
    [onChange]
  );

  const onPickerEvent = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === "android") {
        setPickMode(null);
      }
      if (event.type !== "set" || !date) {
        return;
      }
      applyPickerDate(date);
    },
    [applyPickerDate]
  );

  const timeZones = useMemo(() => listIanaTimeZones(), []);
  const filteredZones = useMemo(() => {
    const q = tzQuery.trim().toLowerCase();
    if (!q) {
      return timeZones;
    }
    return timeZones.filter((z) => z.toLowerCase().includes(q));
  }, [timeZones, tzQuery]);

  const renderTzRow = useCallback(
    ({ item }: ListRenderItemInfo<string>) => (
      <Pressable
        onPress={() => {
          setTimeZoneId(item);
          setTzModalOpen(false);
          setTzQuery("");
        }}
        style={({ pressed }) => [
          styles.tzRow,
          { borderBottomColor: theme.color.border },
          pressed ? { backgroundColor: theme.color.card } : null
        ]}
      >
        <Text style={[styles.tzRowText, { color: theme.color.text }]}>{item}</Text>
        {item === timeZoneId ? (
          <Text style={{ color: theme.color.primary, fontWeight: "700" }}>✓</Text>
        ) : null}
      </Pressable>
    ),
    [theme.color.border, theme.color.card, theme.color.primary, theme.color.text, timeZoneId]
  );

  if (Platform.OS === "web") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={[styles.help, { color: theme.color.muted }]}>
          Race start scheduling uses native pickers on iOS and Android. On web, use the mobile app to set the official
          start time.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.help, { color: theme.color.text }]}>
        Official race clock in the course time zone. Used for Pace, projections, and cutoffs.
      </Text>

      <Text style={[styles.summary, { color: theme.color.text }]} accessibilityRole="text">
        {summary}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose race date"
        disabled={disabled}
        onPress={() => setPickMode("date")}
        style={({ pressed }) => [
          styles.row,
          { borderColor: theme.color.border, backgroundColor: theme.color.card },
          disabled ? styles.rowDisabled : null,
          pressed && !disabled ? { opacity: 0.85 } : null
        ]}
      >
        <Text style={[styles.rowLabel, { color: theme.color.muted }]}>Date</Text>
        <Text style={[styles.rowValue, { color: theme.color.text }]}>
          {DateTime.fromISO(valueIso, { setZone: true }).setZone(timeZoneId).setLocale(deviceLocale).toLocaleString(DateTime.DATE_MED)}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose race time"
        disabled={disabled}
        onPress={() => setPickMode("time")}
        style={({ pressed }) => [
          styles.row,
          { borderColor: theme.color.border, backgroundColor: theme.color.card },
          disabled ? styles.rowDisabled : null,
          pressed && !disabled ? { opacity: 0.85 } : null
        ]}
      >
        <Text style={[styles.rowLabel, { color: theme.color.muted }]}>Time</Text>
        <Text style={[styles.rowValue, { color: theme.color.text }]}>
          {DateTime.fromISO(valueIso, { setZone: true }).setZone(timeZoneId).setLocale(deviceLocale).toLocaleString(DateTime.TIME_SIMPLE)}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose race time zone"
        disabled={disabled}
        onPress={() => {
          setTzModalOpen(true);
        }}
        style={({ pressed }) => [
          styles.row,
          { borderColor: theme.color.border, backgroundColor: theme.color.card },
          disabled ? styles.rowDisabled : null,
          pressed && !disabled ? { opacity: 0.85 } : null
        ]}
      >
        <Text style={[styles.rowLabel, { color: theme.color.muted }]}>Time zone</Text>
        <Text style={[styles.rowValue, { color: theme.color.text }]} numberOfLines={2}>
          {timeZoneId}
        </Text>
      </Pressable>

      {Platform.OS === "android" && pickMode ? (
        <DateTimePicker
          value={valueAsDate}
          mode={pickMode}
          display="default"
          timeZoneName={timeZoneId}
          onChange={onPickerEvent}
        />
      ) : null}

      {Platform.OS === "ios" ? (
        <Modal visible={pickMode !== null} transparent animationType="fade">
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setPickMode(null)} />
            <View style={[styles.modalSheet, { backgroundColor: theme.color.card }]}>
              <View style={styles.modalHeader}>
                <DSButton preset="secondary" onPress={() => setPickMode(null)}>
                  Cancel
                </DSButton>
              </View>
              {pickMode ? (
                <DateTimePicker
                  value={iosDraftDate}
                  mode={pickMode}
                  display="spinner"
                  timeZoneName={timeZoneId}
                  onChange={(_e, date) => {
                    if (date) {
                      setIosDraftDate(date);
                    }
                  }}
                />
              ) : null}
              <View style={{ padding: 12 }}>
                <DSButton
                  preset="primary"
                  onPress={() => {
                    applyPickerDate(iosDraftDate);
                    setPickMode(null);
                  }}
                >
                  Done
                </DSButton>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal visible={tzModalOpen} animationType="slide">
        <View style={[styles.tzModalRoot, { backgroundColor: theme.color.background }]}>
          <Text style={[styles.tzModalTitle, { color: theme.color.text }]}>Race time zone</Text>
          <DSTextInput
            value={tzQuery}
            onChangeText={setTzQuery}
            placeholder="Search city or region"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={filteredZones}
            keyExtractor={(item) => item}
            renderItem={renderTzRow}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            maxToRenderPerBatch={48}
            windowSize={10}
          />
          <View style={{ paddingVertical: 8 }}>
            <DSButton preset="secondary" onPress={() => setTzModalOpen(false)}>
              Close
            </DSButton>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  help: { fontSize: 14, lineHeight: 20 },
  summary: { fontSize: 16, fontWeight: "600" },
  row: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  rowDisabled: { opacity: 0.45 },
  rowLabel: { fontSize: 13, fontWeight: "600", width: 88 },
  rowValue: { flex: 1, fontSize: 16, fontWeight: "500", textAlign: "right" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)"
  },
  modalSheet: {
    paddingBottom: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 8,
    paddingTop: 8
  },
  tzModalRoot: { flex: 1, padding: 16, gap: 10 },
  tzModalTitle: { fontSize: 20, fontWeight: "700" },
  tzRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  tzRowText: { fontSize: 15, flex: 1, paddingRight: 8 }
});
