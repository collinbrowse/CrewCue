import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DSCard } from "../design-system";
import { useAuthedShell } from "../shell/AuthedShellContext";

export function ChatPlaceholderScreen(): ReactElement {
  const s = useAuthedShell();
  return (
    <View style={[s.styles.container, styles.center]}>
      <DSCard style={[s.styles.card, styles.card]}>
        <Text style={s.styles.title}>Chat</Text>
        <Text style={s.styles.body}>Crew chat is coming soon. Use Map and Pace for live race context.</Text>
      </DSCard>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 16 },
  card: { padding: 20 }
});
