import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GuestHomeScreen } from "./GuestHomeScreen";
import { JoinCrewEntryScreen } from "./JoinCrewEntryScreen";
import { JoinCrewPreviewScreen } from "./JoinCrewPreviewScreen";
import { JoinCrewAccountScreen } from "./JoinCrewAccountScreen";
import { AthleteSetupWizardScreen } from "./AthleteSetupWizardScreen";
import { OnboardingNotificationsScreen } from "./OnboardingNotificationsScreen";
import { DevScheduleSheetFixtureScreen } from "./DevScheduleSheetFixtureScreen";
import { DevColdStartFixtureScreen } from "./DevColdStartFixtureScreen";
import { DevGpxImportProgressScreen } from "./DevGpxImportProgressScreen";
import { useNavColors } from "./navigationTheme";
import type { GuestStackParamList } from "./types";

const Stack = createNativeStackNavigator<GuestStackParamList>();

export function GuestStack(): ReactElement {
  const navColors = useNavColors();
  return (
    <Stack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: navColors.background },
        headerShown: false
      }}
    >
      <Stack.Screen name="Home" component={GuestHomeScreen} />
      <Stack.Screen name="JoinEntry" component={JoinCrewEntryScreen} />
      <Stack.Screen name="JoinPreview" component={JoinCrewPreviewScreen} />
      <Stack.Screen name="JoinAccount" component={JoinCrewAccountScreen} />
      <Stack.Screen name="AthleteSetup" component={AthleteSetupWizardScreen} />
      <Stack.Screen name="Notifications" component={OnboardingNotificationsScreen} />
      {/* __DEV__ agent QA: crewcue://dev/schedule-sheet — not an Auth0 bypass */}
      {__DEV__ ? (
        <Stack.Screen
          name="DevScheduleSheet"
          component={DevScheduleSheetFixtureScreen}
          options={{ headerShown: true, title: "Crew schedule (DEV)" }}
        />
      ) : null}
      {/* __DEV__ agent QA: crewcue://dev/crew-sheet-export — same fixture, export-focused entry */}
      {__DEV__ ? (
        <Stack.Screen
          name="DevCrewSheetExport"
          component={DevScheduleSheetFixtureScreen}
          options={{ headerShown: true, title: "Crew sheet export (DEV)" }}
        />
      ) : null}
      {/* __DEV__ agent QA: crewcue://dev/cold-start — not an Auth0 bypass */}
      {__DEV__ ? (
        <Stack.Screen
          name="DevColdStart"
          component={DevColdStartFixtureScreen}
          options={{ headerShown: true, title: "Cold start (DEV)" }}
        />
      ) : null}
      {/* __DEV__ agent QA: crewcue://dev/gpx-import-progress — not an Auth0 bypass */}
      {__DEV__ ? (
        <Stack.Screen
          name="DevGpxImportProgress"
          component={DevGpxImportProgressScreen}
          options={{ headerShown: true, title: "GPX import progress (DEV)" }}
        />
      ) : null}
    </Stack.Navigator>
  );
}
