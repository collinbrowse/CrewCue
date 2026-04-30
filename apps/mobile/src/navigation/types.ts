import type { NavigatorScreenParams } from "@react-navigation/native";

export type GuestStackParamList = {
  Home: undefined;
};

export type OperateStackParamList = {
  OperateHome: undefined;
  RacePlanning: { mode?: "create" | "edit" } | undefined;
  JoinRoomDetails: { roomCode?: string } | undefined;
  WorkspaceMenu: undefined;
  ManageRoomMembers: undefined;
};

export type ReadoutsStackParamList = {
  ReadoutsHome: undefined;
  ReadoutsIncidents: undefined;
  GpxImport: undefined;
};

export type CrewMainTabParamList = {
  Operate: NavigatorScreenParams<OperateStackParamList>;
  Readouts: NavigatorScreenParams<ReadoutsStackParamList>;
};
