import type { LinkingOptions } from "@react-navigation/native";

export const crewCueLinking: LinkingOptions<any> = {
  prefixes: ["crewcue://"],
  config: {
    screens: {
      Home: "guest",
      Operate: {
        path: "operate",
        screens: {
          OperateHome: "",
          OperateStatus: "status",
          OperateOutbox: "outbox"
        }
      },
      Readouts: {
        path: "readouts",
        screens: {
          ReadoutsHome: "",
          ReadoutsIncidents: "incidents"
        }
      }
    }
  }
};
