/** Guest stack only — must not include tab routes (Map/Chat/…) or RN dispatches NAVIGATE to missing screens. */
const guestLinkingBase = {
  Home: "guest"
} as const;

/** __DEV__ agent QA: fixture schedule without Auth0. Omitted from production linking. */
const guestDevLinkingScreens =
  typeof __DEV__ !== "undefined" && __DEV__
    ? ({ DevScheduleSheet: "dev/schedule-sheet" } as const)
    : ({} as const);

export const guestLinkingScreens = {
  ...guestLinkingBase,
  ...guestDevLinkingScreens
} as const;

/** Bottom tabs + nested stacks when `CrewMainTabs` is the root navigator. */
export const authedTabLinkingScreens = {
  Map: {
    path: "map",
    screens: {
      MapHome: "",
      CheckpointPickMap: "pick-checkpoint",
      Navigate: "navigate",
      RacePlanning: "race-setup",
      JoinRoomDetails: "join",
      WorkspaceMenu: "menu",
      ManageRoomMembers: "members"
    }
  },
  Pace: {
    path: "course",
    screens: {
      ReadoutsHome: "",
      CourseSettings: "settings",
      ScheduleSheet: "schedule",
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
} as const;
