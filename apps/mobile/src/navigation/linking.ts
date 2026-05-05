import type { LinkingOptions } from "@react-navigation/native";

export const crewCueLinking: LinkingOptions<any> = {
  prefixes: ["crewcue://"],
  config: {
    screens: {
      Home: "guest",
      Map: {
        path: "map",
        screens: {
          MapHome: "",
          Navigate: "navigate",
          RacePlanning: "race-setup",
          JoinRoomDetails: "join",
          WorkspaceMenu: "menu",
          ManageRoomMembers: "members"
        }
      },
      Pace: {
        path: "pace",
        screens: {
          ReadoutsHome: "",
          ReadoutsIncidents: "incidents",
          GpxImport: "gpx"
        }
      },
      Chat: {
        path: "chat",
        screens: {
          ChatHome: ""
        }
      },
      Profile: {
        path: "profile",
        screens: {
          ProfileHome: ""
        }
      }
    }
  }
};
