import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GuestHomeScreen } from "./GuestHomeScreen";
import { navColors } from "./navigationTheme";
import type { GuestStackParamList } from "./types";

const Stack = createNativeStackNavigator<GuestStackParamList>();

export function GuestStack(): ReactElement {
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: navColors.background },
        headerStyle: { backgroundColor: navColors.card },
        headerTintColor: navColors.text,
        headerTitleStyle: { color: navColors.text },
        headerShadowVisible: false
      }}
    >
      <Stack.Screen name="Home" component={GuestHomeScreen} options={{ title: "CrewCue" }} />
    </Stack.Navigator>
  );
}
