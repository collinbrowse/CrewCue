import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AuthenticatedOperateScreen } from "./AuthenticatedOperateScreen";
import { OperateOutboxScreen } from "./OperateOutboxScreen";
import { OperateStatusScreen } from "./OperateStatusScreen";
import { navColors } from "./navigationTheme";
import type { OperateStackParamList } from "./types";

const Stack = createNativeStackNavigator<OperateStackParamList>();

export function OperateStack(): ReactElement {
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
      <Stack.Screen name="OperateHome" component={AuthenticatedOperateScreen} options={{ title: "Operate" }} />
      <Stack.Screen name="OperateStatus" component={OperateStatusScreen} options={{ title: "Status Detail" }} />
      <Stack.Screen name="OperateOutbox" component={OperateOutboxScreen} options={{ title: "Outbox Detail" }} />
    </Stack.Navigator>
  );
}
