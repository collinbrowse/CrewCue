import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { AuthenticatedReadoutsScreen } from "./AuthenticatedReadoutsScreen";
import { CourseSettingsScreen } from "./CourseSettingsScreen";
import { GpxImportScreen } from "./GpxImportScreen";
import { useNavColors } from "./navigationTheme";
import { ReadoutsIncidentsScreen } from "./ReadoutsIncidentsScreen";
import type { ReadoutsStackParamList } from "./types";

const Stack = createNativeStackNavigator<ReadoutsStackParamList>();

export function ReadoutsStack(): ReactElement {
  const navColors = useNavColors();
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        contentStyle: { backgroundColor: navColors.background },
        headerStyle: { backgroundColor: navColors.card },
        headerTintColor: navColors.text,
        headerTitleStyle: { color: navColors.text },
        headerShadowVisible: false
      })}
    >
      <Stack.Screen
        name="ReadoutsHome"
        component={AuthenticatedReadoutsScreen}
        options={({ navigation }) => ({
          title: "Course",
          headerRight: () => (
            <Pressable
              onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit" })}
              style={{ paddingHorizontal: 8, paddingVertical: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Open race setup details"
            >
              <Ionicons name="settings-outline" color={navColors.primary} size={20} />
            </Pressable>
          )
        })}
      />
      <Stack.Screen
        name="ReadoutsIncidents"
        component={ReadoutsIncidentsScreen}
        options={{ title: "Incident Feed Detail" }}
      />
      <Stack.Screen name="GpxImport" component={GpxImportScreen} options={{ title: "GPX Import + Splits" }} />
      <Stack.Screen name="CourseSettings" component={CourseSettingsScreen} options={{ title: "Course settings" }} />
      <Stack.Screen name="CourseRaceSetup" component={GpxImportScreen} options={{ title: "Race setup" }} />
    </Stack.Navigator>
  );
}
