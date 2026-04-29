import type { NavigatorScreenParams } from "@react-navigation/native";

export type GuestStackParamList = {
  Home: undefined;
};

export type OperateStackParamList = {
  OperateHome: undefined;
  RacePlanning: undefined;
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
