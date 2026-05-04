import type { ReactElement } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { GuestHomeScreen } from "./GuestHomeScreen";
import { JoinCrewEntryScreen } from "./JoinCrewEntryScreen";
import { JoinCrewPreviewScreen } from "./JoinCrewPreviewScreen";
import { JoinCrewAccountScreen } from "./JoinCrewAccountScreen";
import { AthleteSetupWizardScreen } from "./AthleteSetupWizardScreen";
import { OnboardingNotificationsScreen } from "./OnboardingNotificationsScreen";
import { navColors } from "./navigationTheme";
import type { GuestStackParamList } from "./types";

const Stack = createNativeStackNavigator<GuestStackParamList>();

export function GuestStack(): ReactElement {
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
    </Stack.Navigator>
  );
}
