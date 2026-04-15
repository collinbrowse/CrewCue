import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>CrewCue WS0 Foundation</Text>
        <Text style={styles.body}>Hybrid iOS and Android baseline is configured.</Text>
      </View>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0f172a"
  },
  card: {
    width: "84%",
    borderRadius: 16,
    padding: 20,
    backgroundColor: "#111827"
  },
  title: {
    color: "#f9fafb",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8
  },
  body: {
    color: "#d1d5db",
    fontSize: 16
  }
});
