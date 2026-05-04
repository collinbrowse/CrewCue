import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, Text } from "react-native";
import { AuthenticatedReadoutsScreen } from "./AuthenticatedReadoutsScreen";
import { GpxImportScreen } from "./GpxImportScreen";
import { navColors } from "./navigationTheme";
import { ReadoutsIncidentsScreen } from "./ReadoutsIncidentsScreen";
import type { ReadoutsStackParamList } from "./types";

const Stack = createNativeStackNavigator<ReadoutsStackParamList>();

export function ReadoutsStack(): ReactElement {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        contentStyle: { backgroundColor: navColors.background },
        headerStyle: { backgroundColor: navColors.card },
        headerTintColor: navColors.text,
        headerTitleStyle: { color: navColors.text },
        headerShadowVisible: false,
        headerRight: () => (
          <Pressable
            onPress={() => navigation.getParent()?.navigate("Operate", { screen: "WorkspaceMenu" })}
            style={{ paddingHorizontal: 8, paddingVertical: 6 }}
          >
            <Text style={{ color: navColors.primary, fontWeight: "700", fontSize: 20 }}>☰</Text>
          </Pressable>
        )
      })}
    >
      <Stack.Screen name="ReadoutsHome" component={AuthenticatedReadoutsScreen} options={{ title: "Readouts" }} />
      <Stack.Screen
        name="ReadoutsIncidents"
        component={ReadoutsIncidentsScreen}
        options={{ title: "Incident Feed Detail" }}
      />
      <Stack.Screen name="GpxImport" component={GpxImportScreen} options={{ title: "GPX Import + Splits" }} />
    </Stack.Navigator>
  );
}
