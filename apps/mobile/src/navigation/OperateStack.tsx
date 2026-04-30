import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, Text } from "react-native";
import { AuthenticatedOperateScreen } from "./AuthenticatedOperateScreen";
import { GpxImportScreen } from "./GpxImportScreen";
import { JoinRoomDetailsScreen } from "./JoinRoomDetailsScreen";
import { ManageRoomMembersScreen } from "./ManageRoomMembersScreen";
import { WorkspaceMenuScreen } from "./WorkspaceMenuScreen";
import { navColors } from "./navigationTheme";
import type { OperateStackParamList } from "./types";

const Stack = createNativeStackNavigator<OperateStackParamList>();

export function OperateStack(): ReactElement {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        contentStyle: { backgroundColor: navColors.background },
        headerStyle: { backgroundColor: navColors.card },
        headerTintColor: navColors.text,
        headerTitleStyle: { color: navColors.text },
        headerShadowVisible: false,
        headerRight: () => (
          <Pressable onPress={() => navigation.navigate("WorkspaceMenu")} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={{ color: "#93c5fd", fontWeight: "700", fontSize: 20 }}>☰</Text>
          </Pressable>
        )
      })}
    >
      <Stack.Screen name="OperateHome" component={AuthenticatedOperateScreen} options={{ title: "Operate" }} />
      <Stack.Screen name="RacePlanning" component={GpxImportScreen} options={{ title: "Race setup" }} />
      <Stack.Screen name="JoinRoomDetails" component={JoinRoomDetailsScreen} options={{ title: "Join race room" }} />
      <Stack.Screen
        name="WorkspaceMenu"
        component={WorkspaceMenuScreen}
        options={{
          title: "Settings",
          headerRight: () => null
        }}
      />
      <Stack.Screen name="ManageRoomMembers" component={ManageRoomMembersScreen} options={{ title: "Manage room members" }} />
    </Stack.Navigator>
  );
}
