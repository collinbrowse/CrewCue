import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useNavColors } from "./navigationTheme";
import { ProfileHomeScreen } from "./ProfileHomeScreen";
import type { ProfileStackParamList } from "./types";

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export function ProfileStack(): ReactElement {
  const navColors = useNavColors();
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
      <Stack.Screen name="ProfileHome" component={ProfileHomeScreen} options={{ title: "Profile" }} />
    </Stack.Navigator>
  );
}
