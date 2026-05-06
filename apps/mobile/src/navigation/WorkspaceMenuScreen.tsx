import type { ReactElement } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DSButton, DSCard } from "../design-system";
import { useDSTheme } from "../design-system/theme";
import { useAuthedShell } from "../shell/AuthedShellContext";
import type { MapStackParamList } from "./types";

export function WorkspaceMenuScreen(): ReactElement {
  const s = useAuthedShell();
  const theme = useDSTheme();
  const navigation = useNavigation<NativeStackNavigationProp<MapStackParamList>>();

  return (
    <ScrollView style={s.styles.container} contentContainerStyle={[s.styles.scroll, { paddingBottom: 28 }]}>
      <DSCard style={s.styles.card}>
        <DSCard style={[s.styles.summaryCard, styles.heroCard]}>
          <Text style={[styles.kicker, { color: theme.color.primary }]}>Map settings</Text>
          <Text style={[styles.heroTitle, { color: theme.color.text }]}>Moved</Text>
          <Text style={[styles.heroBody, { color: theme.color.body }]}>
            This area is now a placeholder. Use Profile for race/workspace controls and Course settings for race setup.
          </Text>
        </DSCard>

        <View style={styles.buttonSpacing}>
          <DSButton
            preset="secondary"
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
                return;
              }
              navigation.navigate("MapHome");
            }}
          >
            Back to map
          </DSButton>
        </View>
      </DSCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(125, 128, 145, 0.6)",
    backgroundColor: "rgba(125, 128, 145, 0.12)"
  },
  kicker: {
    textTransform: "uppercase",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: "800",
    marginTop: 8
  },
  heroBody: {
    marginTop: 8,
    lineHeight: 22
  },
  buttonSpacing: {
    gap: 8,
    marginTop: 10
  }
});
