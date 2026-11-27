/** Worker-thread entry for {@link parseUploadInWorker}: one parse, one reply, then exit. */
import { parentPort, workerData } from "node:worker_threads";
import { parseActivityFileMetrics } from "./activityFileHistory.js";
import { coursePreviewFromGpx } from "./coursePreview.js";
import { parseGpxActivityMetrics } from "./gpxActivityHistory.js";
import type { UploadParseMessage, UploadParseTask } from "./uploadParse.js";

function run(task: UploadParseTask): unknown {
  switch (task.kind) {
    case "gpxActivity":
      return parseGpxActivityMetrics(task.gpxXml);
    case "activityFile":
      return parseActivityFileMetrics(task.bytes, task.fileName);
    case "coursePreview":
      return coursePreviewFromGpx(task.gpxXml, task.courseFileName);
  }
}

let message: UploadParseMessage;
try {
  message = { ok: true, value: run(workerData as UploadParseTask) };
} catch (err) {
  const error = err instanceof Error ? err : new Error(String(err));
  const code = (error as { code?: unknown }).code;
  message = { ok: false, error: { name: error.name, message: error.message, ...(typeof code === "string" ? { code } : {}) } };
}
parentPort?.postMessage(message);
