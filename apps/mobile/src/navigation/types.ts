import type { NavigatorScreenParams } from "@react-navigation/native";

export type GuestStackParamList = {
  Home: { authMode?: "signup" | "signin" } | undefined;
  JoinEntry: undefined;
  JoinPreview: { roomCode: string; displayName: string };
  JoinAccount: { roomCode: string; displayName: string };
  AthleteSetup: undefined;
  Notifications: undefined;
  /** __DEV__ only: fixture schedule sheet for simulator QA (crewcue://dev/schedule-sheet). */
  DevScheduleSheet: undefined;
  /** __DEV__ only: same fixture via export-focused deeplink (crewcue://dev/crew-sheet-export). */
  DevCrewSheetExport: undefined;
  /** __DEV__ only: cold-start estimate UX for simulator QA (crewcue://dev/cold-start). */
  DevColdStart: undefined;
  /** __DEV__ only: course GPX import progress bar (crewcue://dev/gpx-import-progress). */
  DevGpxImportProgress: undefined;
};

/** Primary map + race operations stack (Map tab). */
export type MapStackParamList = {
  MapHome: undefined;
  /** Pace edit flow: pan map so crosshair is the new aid location, then confirm. */
  CheckpointPickMap: { initialLatitude?: number; initialLongitude?: number } | undefined;
  RacePlanning:
    | {
        mode?: "create" | "edit";
        replaceCourseFile?: boolean;
      }
    | undefined;
  Navigate: undefined;
  JoinRoomDetails: { roomCode?: string } | undefined;
  WorkspaceMenu: undefined;
  ManageRoomMembers: undefined;
};

export type ReadoutsStackParamList = {
  ReadoutsHome: { pacePickResult?: { latitude: number; longitude: number } } | undefined;
  ReadoutsIncidents: undefined;
  GpxImport: undefined;
  CourseSettings: undefined;
  /** Read-only crew schedule sheet (W1-4). */
  ScheduleSheet: undefined;
  CourseRaceSetup:
    | {
        mode?: "create" | "edit";
        replaceCourseFile?: boolean;
      }
    | undefined;
  /** __DEV__ only: course GPX import progress (crewcue://course/dev-gpx-import-progress). */
  DevGpxImportProgress: undefined;
};

export type ChatStackParamList = {
  ChatHome: undefined;
  ChatNotificationPrefs: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  ProfileRaceSetup:
    | {
        mode?: "create" | "edit";
        replaceCourseFile?: boolean;
      }
    | undefined;
  ProfileJoinRoomDetails: { roomCode?: string } | undefined;
  ProfileManageRoomMembers: undefined;
};

export type CrewMainTabParamList = {
  Map: NavigatorScreenParams<MapStackParamList>;
  Pace: NavigatorScreenParams<ReadoutsStackParamList>;
  Chat: NavigatorScreenParams<ChatStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

/** @deprecated Use MapStackParamList */
export type OperateStackParamList = MapStackParamList;
