/**
 * Upper bound on the `gpxXml` string in JSON upload bodies. GPX parsing is synchronous, so
 * unbounded input holds the event loop. Real GPX files are a few MB.
 */
export const MAX_GPX_XML_CHARS = 10 * 1024 * 1024;
