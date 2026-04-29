import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Text, View } from "react-native";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

export function AuthenticatedReadoutsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "ReadoutsHome">>();

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Readouts</Text>
        <Text style={s.styles.subtitle}>Projection, timeline, incidents, and adaptive context</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Decision focus</Text>
          <Text style={s.styles.body}>
            Prioritize stale sync alerts, new incidents, and pending recommendations before scanning deeper readouts.
          </Text>
        </DSCard>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DSButton preset="secondary" onPress={() => navigation.navigate("ReadoutsIncidents")}>
              Incident Feed Detail
            </DSButton>
          </View>
        </View>

        <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
          <Text style={s.styles.summaryTitle}>What to open next</Text>
          <Text style={s.styles.body}>Use Incident Feed Detail when reviewing race events and recommendations.</Text>
        </DSCard>
      </DSCard>
    </ScrollView>
  );
}
