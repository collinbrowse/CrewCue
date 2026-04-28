import type { ReactElement } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { navColors } from "./navigationTheme";
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
          backgroundColor: navColors.card,
          borderTopColor: navColors.border
        },
        tabBarActiveTintColor: navColors.text,
        tabBarInactiveTintColor: navColors.muted
      }}
    >
      <Tab.Screen name="Operate" component={OperateStack} options={{ title: "Operate" }} />
      <Tab.Screen name="Readouts" component={ReadoutsStack} options={{ title: "Readouts" }} />
    </Tab.Navigator>
  );
}
