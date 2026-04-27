import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function ReadoutsIncidentsScreen(): ReactElement {
  const s = useAuthedShell();
  const incidents = s.incidents ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#0f172a" }} contentContainerStyle={s.styles.scroll}>
      <View style={s.styles.card}>
        <Text style={s.styles.title}>Incident Feed</Text>
        <Text style={s.styles.subtitle}>Focused WS4 incident timeline for rapid triage</Text>
        <Text style={s.styles.label}>Incident count</Text>
        <Text style={s.styles.code}>{incidents.length}</Text>
        {incidents.length === 0 ? (
          <Text style={s.styles.body}>No incidents loaded yet. Use Operate actions to post/fetch incidents.</Text>
        ) : (
          incidents
            .slice()
            .reverse()
            .map((incident) => (
              <View key={incident.id} style={s.styles.summaryCard}>
                <Text style={s.styles.summaryTitle}>
                  {incident.category} · {incident.severity}
                </Text>
                <Text style={s.styles.body}>{incident.summary}</Text>
                {incident.details ? <Text style={s.styles.body}>{incident.details}</Text> : null}
                <Text style={s.styles.code}>{incident.recordedAt}</Text>
              </View>
            ))
        )}
      </View>
    </ScrollView>
  );
}
