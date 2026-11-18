/**
 * The full delete of one race room, shared by account deletion (#560) and the unpaid race sweeper
 * (lib/unpaidRaceExpiryScheduler.ts), so both remove the same things: the room row and cache,
 * invites, task board, WS2 runtime (ping state, projection, track), WS4/WS5 state, schedule and
 * stop plans (on the room document), tracking and unpaid-race reminder claims, the room's event
 * log, crew chat (messages, photos, prefs), the finished effort, the course-history record and
 * the people the owner removed from it.
 *
 * Every step is idempotent, so a repeat, or two deleters at once, end in the same state.
 */
import {
  checkRaceRoomDeleteCondition,
  deleteRaceRoomRecord,
  type RaceRoomDeleteCondition,
  type RaceRoomDeletion
} from "../routes/raceRooms.js";
import { deleteChatRoomData } from "./chatPersistence.js";
import { deleteCrewCueRoomCourseHistory } from "./courseHistory/store.js";
import { deleteFinishedEffortForRoom } from "./finishedEffortStore.js";
import { forgetPlatformEventsForRoom } from "./platformEventLog.js";
import { deleteRoomRemovalsForRoom } from "./roomRemovalStore.js";

export type RaceRoomDeletionOptions = {
  /**
   * Throw when the chat photo store deleted fewer photos than it was given (a 403 or 5xx from the
   * bucket counts as not deleted). The first pass then stops before the message rows and the room
   * row, so the race and the photo keys stay and a retry finds them. The unpaid race sweeper
   * passes it; account deletion does not (it goes on past such a photo, as chat retention does).
   */
  requireEveryChatPhotoDeleted?: boolean;
};

/**
 * The room's data kept outside the room's own tables: chat, the finished effort, course history,
 * memory event log. Not the removed members: those go only once the room row is gone.
 */
async function deleteRaceRoomDataOutsideRecord(roomId: string, options: RaceRoomDeletionOptions): Promise<void> {
  await deleteChatRoomData(roomId, { throwIfPhotosLeft: options.requireEveryChatPhotoDeleted === true });
  await deleteFinishedEffortForRoom(roomId);
  await deleteCrewCueRoomCourseHistory(roomId);
  forgetPlatformEventsForRoom(roomId);
}

/**
 * Delete the room and everything keyed by it. With `onlyIf`, the room is asked about under its
 * lock first, and nothing is touched unless `onlyIf` says yes (`kept`). A room already gone
 * answers `gone`: its leftovers are removed and it is not an error.
 *
 * The room row goes last but one. Chat, the finished effort and course history are deleted while
 * the room is still stored, so a failure or a crash partway (a deploy's bounded shutdown) leaves
 * the race listed, and the next sweeper tick, or the account deletion retry, runs the whole delete
 * again; deleting the row first would leave them with nothing to find them by. The row delete asks
 * `onlyIf` again under the lock, so a purchase that lands in between still keeps the race (for
 * the sweeper that is a race never paid, which has no chat, pings or finished effort to lose).
 * Afterwards the records of the people the owner removed (lib/roomRemovalStore.ts) are deleted,
 * then the outside data once more, for anything written in between (a chat message sent meanwhile).
 *
 * The removed members go only after the row: they are what keeps a removed person from rejoining
 * by code, so a race kept by the second ask (a purchase during the sweep) keeps them, and a crash
 * right after the row delete leaves rows for a room that is gone, which readmit nobody.
 *
 * A `kept` from the second ask comes back with chat, the finished effort and course history
 * already deleted. Pass an `onlyIf` only for rooms that cannot have that data (the sweeper's
 * unpaid races, which refuse chat and pings with 402).
 */
export async function deleteRaceRoomAndData(
  roomId: string,
  onlyIf?: RaceRoomDeleteCondition,
  options: RaceRoomDeletionOptions = {}
): Promise<RaceRoomDeletion> {
  if (onlyIf && (await checkRaceRoomDeleteCondition(roomId, onlyIf)) === "kept") {
    return "kept";
  }
  await deleteRaceRoomDataOutsideRecord(roomId, options);
  const result = await deleteRaceRoomRecord(roomId, onlyIf);
  if (result === "kept") {
    return result;
  }
  await deleteRoomRemovalsForRoom(roomId);
  await deleteRaceRoomDataOutsideRecord(roomId, options);
  return result;
}
