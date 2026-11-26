import { announcedRun } from "@t3tools/client-runtime/state/thread-activity-announcement";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2Run, RunId } from "@t3tools/contracts";

export function offeredPromptSuggestion<Suggestion extends { readonly runId: RunId }>(
  suggestion: Suggestion | null | undefined,
  latestRun: EnvironmentThreadShell["latestRun"] | undefined,
  runs: ReadonlyArray<OrchestrationV2Run>,
): Suggestion | null {
  const run = announcedRun(latestRun ?? null, runs);
  const skippedUnseenRun =
    latestRun != null &&
    run?.runId !== latestRun.runId &&
    !runs.some(
      (candidate) =>
        candidate.id === latestRun.runId &&
        candidate.status === "cancelled" &&
        candidate.startedAt === null,
    );
  return suggestion &&
    !skippedUnseenRun &&
    run?.runId === suggestion.runId &&
    run.status === "completed"
    ? suggestion
    : null;
}
