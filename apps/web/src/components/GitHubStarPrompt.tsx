import type { EnvironmentId } from "@t3tools/contracts";

/** Disabled in personal builds so no GitHub star/review toast ever appears. */
export async function recordPromptSent(_environmentId: EnvironmentId): Promise<void> {}
