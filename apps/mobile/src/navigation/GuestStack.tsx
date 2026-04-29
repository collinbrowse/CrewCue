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
        headerShown: false
      }}
    >
      <Stack.Screen name="Home" component={GuestHomeScreen} />
    </Stack.Navigator>
  );
}
