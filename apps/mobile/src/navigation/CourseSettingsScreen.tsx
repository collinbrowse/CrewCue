import { useMemo, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

export function CourseSettingsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "CourseSettings">>();
  const selectedRaceName = useMemo(() => s.room?.name?.trim() || "No race selected", [s.room?.name]);

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 28 }]}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Course settings</Text>
        <Text style={s.styles.subtitle}>Manage current-race setup actions for this tab.</Text>

        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Selected race</Text>
          <Text style={s.styles.body}>{selectedRaceName}</Text>
        </DSCard>

        <View style={{ gap: 8, marginTop: 12 }}>
          {s.room ? (
            <>
              <DSButton preset="secondary" onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit" })}>
                Race setup
              </DSButton>
              <DSButton
                preset="secondary"
                onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit", replaceCourseFile: true })}
              >
                Replace course file
              </DSButton>
            </>
          ) : null}
        </View>
      </DSCard>
    </ScrollView>
  );
}
