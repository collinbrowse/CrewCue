import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthenticatedReadoutsScreen } from "./AuthenticatedReadoutsScreen";
import { ReadoutsIncidentsScreen } from "./ReadoutsIncidentsScreen";
import type { ReadoutsStackParamList } from "./types";

const Stack = createNativeStackNavigator<ReadoutsStackParamList>();

export function ReadoutsStack(): ReactElement {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: "#0f172a" },
        headerStyle: { backgroundColor: "#111827" },
        headerTintColor: "#f9fafb",
        headerTitleStyle: { color: "#f9fafb" },
        headerShadowVisible: false
      }}
    >
      <Stack.Screen name="ReadoutsHome" component={AuthenticatedReadoutsScreen} options={{ title: "Readouts" }} />
      <Stack.Screen
        name="ReadoutsIncidents"
        component={ReadoutsIncidentsScreen}
        options={{ title: "Incident Feed Detail" }}
      />
    </Stack.Navigator>
  );
}
