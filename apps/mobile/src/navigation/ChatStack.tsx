import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ChatPlaceholderScreen } from "./ChatPlaceholderScreen";
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
      <Stack.Screen name="ChatHome" component={ChatPlaceholderScreen} options={{ title: "Chat" }} />
    </Stack.Navigator>
  );
}
