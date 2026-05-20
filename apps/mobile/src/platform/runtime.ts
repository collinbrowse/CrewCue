import {
  createActionRegistry,
  createNoticeBus,
  type ActionRegistry,
  type NoticeBus
} from "@crewcue/platform-client";

export const appActionRegistry: ActionRegistry = createActionRegistry();
export const appNoticeBus: NoticeBus = createNoticeBus();
