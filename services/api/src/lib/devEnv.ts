/**
 * Local development and tests only. Dev-only behavior (the public HS256 dev secret, hand-set
 * billing) needs NODE_ENV set to one of these on purpose; unset or anything else counts as deployed.
 */
export const EXPLICIT_DEV_NODE_ENVS: readonly string[] = ["development", "test"];

export function isExplicitDevEnv(nodeEnv: string | undefined): boolean {
  return EXPLICIT_DEV_NODE_ENVS.includes(nodeEnv?.trim() ?? "");
}
