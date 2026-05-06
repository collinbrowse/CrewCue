import type { NavigatorScreenParams } from "@react-navigation/native";

export type GuestStackParamList = {
  Home: { authMode?: "signup" | "signin" } | undefined;
  JoinEntry: undefined;
  JoinPreview: { roomCode: string; displayName: string };
  JoinAccount: { roomCode: string; displayName: string };
  AthleteSetup: undefined;
  Notifications: undefined;
};

/** Primary map + race operations stack (Map tab). */
export type MapStackParamList = {
  MapHome: undefined;
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
  ReadoutsHome: undefined;
  ReadoutsIncidents: undefined;
  GpxImport: undefined;
  CourseSettings: undefined;
  CourseRaceSetup:
    | {
        mode?: "create" | "edit";
        replaceCourseFile?: boolean;
      }
    | undefined;
};

export type ChatStackParamList = {
  ChatHome: undefined;
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
