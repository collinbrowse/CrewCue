import { createWebApiClient } from "../api/client";

export type AnalyticsProps = Record<string, unknown>;

export async function emitWebAnalytics(options: {
  baseUrl: string;
  accessToken: string | undefined;
  event: string;
  properties?: AnalyticsProps;
}): Promise<void> {
  if (import.meta.env.DEV) {
    console.info("[analytics]", options.event, options.properties ?? {});
  }
  if (!options.accessToken) {
    return;
  }
  const client = createWebApiClient({ baseUrl: options.baseUrl, accessToken: options.accessToken });
  await client.postAnalyticsEvents([
    { name: options.event, properties: options.properties, occurredAt: new Date().toISOString() }
  ]);
}
