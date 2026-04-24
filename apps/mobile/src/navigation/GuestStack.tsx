import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GuestHomeScreen } from "./GuestHomeScreen";
import type { GuestStackParamList } from "./types";

const Stack = createNativeStackNavigator<GuestStackParamList>();

export function GuestStack(): ReactElement {
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
      <Stack.Screen name="Home" component={GuestHomeScreen} options={{ title: "CrewCue" }} />
    </Stack.Navigator>
  );
}
