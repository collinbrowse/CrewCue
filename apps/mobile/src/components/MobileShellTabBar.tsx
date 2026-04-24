import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";

export type MobileShellTab = "operate" | "readouts";

type Props = {
  styles: any;
  active: MobileShellTab;
  onChange: (tab: MobileShellTab) => void;
};

export function MobileShellTabBar({ styles, active, onChange }: Props): ReactElement {
  return (
    <View style={styles.tabRow}>
      <Pressable
        style={[styles.tabButton, active === "operate" ? styles.tabButtonActive : null]}
        onPress={() => {
          onChange("operate");
        }}
      >
        <Text style={active === "operate" ? styles.tabButtonLabelActive : styles.tabButtonLabel}>Operate</Text>
      </Pressable>
      <Pressable
        style={[styles.tabButton, active === "readouts" ? styles.tabButtonActive : null]}
        onPress={() => {
          onChange("readouts");
        }}
      >
        <Text style={active === "readouts" ? styles.tabButtonLabelActive : styles.tabButtonLabel}>Readouts</Text>
      </Pressable>
    </View>
  );
}
