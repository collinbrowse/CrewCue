import { createApiClient } from "../api/client";

export type AnalyticsProps = Record<string, unknown>;

/** Send one analytics event (navigation / offline / map workspace instrumentation). */
export async function emitAnalytics(options: {
  baseUrl: string;
  accessToken: string | undefined;
  event: string;
  properties?: AnalyticsProps;
}): Promise<void> {
  if (__DEV__) {
    console.info("[analytics]", options.event, options.properties ?? {});
  }
  if (!options.accessToken) {
    return;
  }
  const client = createApiClient({ baseUrl: options.baseUrl, accessToken: options.accessToken });
  await client.postAnalyticsEvents([
    { name: options.event, properties: options.properties, occurredAt: new Date().toISOString() }
  ]);
}
