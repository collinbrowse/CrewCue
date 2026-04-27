import type { ReactElement } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { OperateStack } from "./OperateStack";
import { ReadoutsStack } from "./ReadoutsStack";
import type { CrewMainTabParamList } from "./types";

const Tab = createBottomTabNavigator<CrewMainTabParamList>();

export function CrewMainTabs(): ReactElement {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#111827",
          borderTopColor: "#1f2937"
        },
        tabBarActiveTintColor: "#f9fafb",
        tabBarInactiveTintColor: "#9ca3af"
      }}
    >
      <Tab.Screen name="Operate" component={OperateStack} options={{ title: "Operate" }} />
      <Tab.Screen name="Readouts" component={ReadoutsStack} options={{ title: "Readouts" }} />
    </Tab.Navigator>
  );
}
