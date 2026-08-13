import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { AuthenticatedReadoutsScreen } from "./AuthenticatedReadoutsScreen";
import { CourseSettingsScreen } from "./CourseSettingsScreen";
import { CrewScheduleSheetScreen } from "./CrewScheduleSheetScreen";
import { GpxImportScreen } from "./GpxImportScreen";
import { useNavColors } from "./navigationTheme";
import { ReadoutsIncidentsScreen } from "./ReadoutsIncidentsScreen";
import type { ReadoutsStackParamList } from "./types";

const Stack = createNativeStackNavigator<ReadoutsStackParamList>();

export function ReadoutsStack(): ReactElement {
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
        name="ReadoutsHome"
        component={AuthenticatedReadoutsScreen}
        options={({ navigation }) => ({
          title: "Pace",
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable
                onPress={() => navigation.navigate("ScheduleSheet")}
                style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Crew schedule"
              >
                <Ionicons name="calendar-outline" color={navColors.primary} size={20} />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("CourseRaceSetup", { mode: "edit" })}
                style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                accessibilityRole="button"
                accessibilityLabel="Open race setup details"
              >
                <Ionicons name="settings-outline" color={navColors.primary} size={20} />
              </Pressable>
            </View>
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
      <Stack.Screen name="ScheduleSheet" component={CrewScheduleSheetScreen} options={{ title: "Crew schedule" }} />
      <Stack.Screen name="CourseRaceSetup" component={GpxImportScreen} options={{ title: "Race setup" }} />
    </Stack.Navigator>
  );
}
