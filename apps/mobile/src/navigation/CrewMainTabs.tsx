import { Ionicons } from "@expo/vector-icons";
import type { ReactElement } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { ChatStack } from "./ChatStack";
import { MapStack } from "./MapStack";
import { ProfileStack } from "./ProfileStack";
import { ReadoutsStack } from "./ReadoutsStack";
import { useChatUnreadBadge } from "../features/chat/unreadBadge";
import { useNavColors } from "./navigationTheme";
import type { CrewMainTabParamList } from "./types";

const Tab = createBottomTabNavigator<CrewMainTabParamList>();

export function CrewMainTabs(): ReactElement {
  const navColors = useNavColors();
  const chatBadge = useChatUnreadBadge();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: navColors.card,
          borderTopColor: navColors.border
        },
        tabBarActiveTintColor: navColors.primary,
        tabBarInactiveTintColor: navColors.muted
      }}
    >
      <Tab.Screen
        name="Map"
        component={MapStack}
        options={{
          title: "Map",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "compass" : "compass-outline"} size={size} color={color} />
          )
        }}
      />
      <Tab.Screen
        name="Pace"
        component={ReadoutsStack}
        options={{
          title: "Course",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "stopwatch" : "stopwatch-outline"} size={size} color={color} />
          )
        }}
      />
      <Tab.Screen
        name="Chat"
        component={ChatStack}
        options={{
          title: "Chat",
          tabBarBadge: chatBadge,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "chatbubble" : "chatbubble-outline"} size={size} color={color} />
          )
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={size} color={color} />
          )
        }}
      />
    </Tab.Navigator>
  );
}
