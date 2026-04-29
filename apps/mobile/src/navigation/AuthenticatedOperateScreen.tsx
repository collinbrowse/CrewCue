import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Share, Text, View } from "react-native";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { OperateStackParamList } from "./types";

export function AuthenticatedOperateScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<OperateStackParamList, "OperateHome">>();
  const inRace = Boolean(s.room && s.raceProfile?.setupComplete);

  return (
    <ScrollView
      style={s.styles.container}
      contentContainerStyle={s.styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>CrewCue</Text>
        <Text style={s.styles.subtitle}>Race operations control center</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>{inRace ? "You are in your race" : "Start your race setup"}</Text>
          <Text style={s.styles.body}>
            {inRace
              ? "Review race details, update your route, and share the crew link so everyone sees the same plan."
              : "Set up race details, optionally upload GPX, and share your crew link from one planning flow."}
          </Text>
        </DSCard>

        <DSCard style={[s.styles.summaryCard, { marginTop: 12 }]}>
          <Text style={s.styles.summaryTitle}>Race details</Text>
          {inRace ? (
            <>
              <Text style={s.styles.body}>Race name: {s.raceProfile?.raceName || s.room?.name}</Text>
              <Text style={s.styles.body}>
                Crew name: {s.raceProfile?.crewName?.trim() ? s.raceProfile.crewName : "Not set"}
              </Text>
              <Text style={s.styles.body}>
                Description: {s.raceProfile?.raceDescription?.trim() ? s.raceProfile.raceDescription : "Not set"}
              </Text>
              <Text style={s.styles.body}>Course uploaded: {s.room?.course ? "Yes" : "No"}</Text>
            </>
          ) : (
            <Text style={s.styles.body}>
              You are not in a race yet. Tap Start planning your race to create your race and optional setup details.
            </Text>
          )}
        </DSCard>

        <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <DSButton preset="primary" onPress={() => navigation.navigate("RacePlanning")}>
              Start planning your race
            </DSButton>
          </View>
        </View>

        {inRace ? (
          <View style={{ marginTop: 12, flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <DSButton
                preset="secondary"
                onPress={() => {
                  if (!s.room) return;
                  const shareLink = `crewcue://join?roomId=${encodeURIComponent(s.room.id)}`;
                  void Share.share({ message: `Join my CrewCue race room: ${shareLink}` });
                }}
              >
                Share crew link
              </DSButton>
            </View>
          </View>
        ) : null}

      </DSCard>
    </ScrollView>
  );
}
