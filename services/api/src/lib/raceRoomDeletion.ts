/**
 * The full delete of one race room, shared by account deletion (#560) and the unpaid race sweeper
 * (lib/unpaidRaceExpiryScheduler.ts), so both remove the same things: the room row and cache,
 * invites, task board, WS2 runtime (ping state, projection, track), WS4/WS5 state, schedule and
 * stop plans (on the room document), tracking reminder claims, the room's event log, crew chat
 * (messages, photos, prefs), the finished effort and the course-history record.
 *
 * Every step is idempotent, so a repeat, or two deleters at once, end in the same state.
 */
import { deleteRaceRoomRecord, type RaceRoomDeleteCondition, type RaceRoomDeletion } from "../routes/raceRooms.js";
import { deleteChatRoomData } from "./chatPersistence.js";
import { deleteCrewCueRoomCourseHistory } from "./courseHistory/store.js";
import { deleteFinishedEffortForRoom } from "./finishedEffortStore.js";
import { forgetPlatformEventsForRoom } from "./platformEventLog.js";

/**
 * Delete the room and everything keyed by it. With `onlyIf`, the room is re-read under its lock
 * and nothing is touched unless `onlyIf` says yes (`kept`). A room already gone answers `gone`:
 * its leftovers are removed and it is not an error.
 */
export async function deleteRaceRoomAndData(
  roomId: string,
  onlyIf?: RaceRoomDeleteCondition
): Promise<RaceRoomDeletion> {
  const result = await deleteRaceRoomRecord(roomId, onlyIf);
  if (result === "kept") {
    return result;
  }
  await deleteChatRoomData(roomId);
  await deleteFinishedEffortForRoom(roomId);
  await deleteCrewCueRoomCourseHistory(roomId);
  forgetPlatformEventsForRoom(roomId);
  return result;
}
