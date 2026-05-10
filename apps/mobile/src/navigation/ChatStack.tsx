import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ChatNotificationPrefsScreen } from "./ChatNotificationPrefsScreen";
import { CrewChatScreen } from "./CrewChatScreen";
import { useNavColors } from "./navigationTheme";
import type { ChatStackParamList } from "./types";

const Stack = createNativeStackNavigator<ChatStackParamList>();

export function ChatStack(): ReactElement {
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
      <Stack.Screen
        name="ChatHome"
        component={CrewChatScreen}
        options={{ title: "", headerShown: true }}
      />
      <Stack.Screen
        name="ChatNotificationPrefs"
        component={ChatNotificationPrefsScreen}
        options={{ title: "Notifications" }}
      />
    </Stack.Navigator>
  );
}
