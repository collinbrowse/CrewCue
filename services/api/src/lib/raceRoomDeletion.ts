/**
 * The full delete of one race room, shared by account deletion (#560) and the unpaid race sweeper
 * (lib/unpaidRaceExpiryScheduler.ts), so both remove the same things: the room row and cache,
 * invites, task board, WS2 runtime (ping state, projection, track), WS4/WS5 state, schedule and
 * stop plans (on the room document), tracking reminder claims, the room's event log, crew chat
 * (messages, photos, prefs), the finished effort and the course-history record.
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

/** The room's data kept outside the room's own tables: chat, the finished effort, course history, memory event log. */
async function deleteRaceRoomDataOutsideRecord(roomId: string): Promise<void> {
  await deleteChatRoomData(roomId);
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
 * Afterwards the outside data is deleted once more, for anything written in between (a chat
 * message sent meanwhile).
 */
export async function deleteRaceRoomAndData(
  roomId: string,
  onlyIf?: RaceRoomDeleteCondition
): Promise<RaceRoomDeletion> {
  if (onlyIf && (await checkRaceRoomDeleteCondition(roomId, onlyIf)) === "kept") {
    return "kept";
  }
  await deleteRaceRoomDataOutsideRecord(roomId);
  const result = await deleteRaceRoomRecord(roomId, onlyIf);
  if (result === "kept") {
    return result;
  }
  await deleteRaceRoomDataOutsideRecord(roomId);
  return result;
}
