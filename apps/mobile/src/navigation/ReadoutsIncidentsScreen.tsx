import type { ReactElement } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ScrollView, Text } from "react-native";
import { DSButton, DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { ReadoutsStackParamList } from "./types";

export function ReadoutsIncidentsScreen(): ReactElement {
  const s = useAuthedShell();
  const navigation = useNavigation<NativeStackNavigationProp<ReadoutsStackParamList, "ReadoutsIncidents">>();
  const incidents = s.incidents ?? [];
  const highCount = incidents.filter((incident) => incident.severity === "high").length;
  const mediumCount = incidents.filter((incident) => incident.severity === "medium").length;
  const lowCount = incidents.filter((incident) => incident.severity === "low").length;

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={s.styles.scroll}>
      <DSCard style={s.styles.card}>
        <Text style={s.styles.title}>Incident Feed</Text>
        <Text style={s.styles.subtitle}>Focused WS4 incident timeline for rapid triage</Text>
        <DSCard style={s.styles.summaryCard}>
          <Text style={s.styles.summaryTitle}>Triage summary</Text>
          <Text style={[s.styles.code, s.styles.errorText]}>High: {highCount}</Text>
          <Text style={[s.styles.code, s.styles.warningText]}>Medium: {mediumCount}</Text>
          <Text style={[s.styles.code, s.styles.mutedText]}>Low: {lowCount}</Text>
          <Text style={s.styles.body}>
            After triage, return to Readouts and run recommendation generation/decision actions.
          </Text>
        </DSCard>
        <DSButton preset="secondary" onPress={() => navigation.navigate("ReadoutsHome")}>
          Return to Readouts actions
        </DSButton>
        <Text style={s.styles.label}>Incident count</Text>
        <Text style={s.styles.code}>{incidents.length}</Text>
        {incidents.length === 0 ? (
          <Text style={s.styles.body}>No incidents loaded yet. Use Operate actions to post/fetch incidents.</Text>
        ) : (
          incidents
            .slice()
            .reverse()
            .map((incident) => (
              <DSCard key={incident.id} style={s.styles.summaryCard}>
                <Text
                  style={[
                    s.styles.summaryTitle,
                    incident.severity === "high"
                      ? s.styles.errorText
                      : incident.severity === "medium"
                        ? s.styles.warningText
                        : s.styles.successText
                  ]}
                >
                  {incident.category} · {incident.severity}
                </Text>
                <Text style={s.styles.body}>{incident.summary}</Text>
                {incident.details ? <Text style={s.styles.body}>{incident.details}</Text> : null}
                <Text style={s.styles.code}>{incident.recordedAt}</Text>
              </DSCard>
            ))
        )}
      </DSCard>
    </ScrollView>
  );
}
