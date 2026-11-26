import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationV2Run, RunId } from "@t3tools/contracts";

import { offeredPromptSuggestion } from "./promptSuggestion.logic";

describe("offeredPromptSuggestion (mobile)", () => {
  it("returns the suggestion only when it matches the latest completed run", () => {
    const runId = "run-1" as RunId;
    const latestRun = {
      runId,
      status: "completed" as const,
      requestedAt: "2026-11-26T00:00:00.000Z",
      startedAt: "2026-11-26T00:00:00.000Z",
      completedAt: "2026-11-26T00:01:00.000Z",
      assistantMessageId: null,
    };
    const runs = [
      {
        id: runId,
        status: "completed",
        startedAt: "2026-11-26T00:00:00.000Z",
        completedAt: "2026-11-26T00:01:00.000Z",
      },
    ] as unknown as ReadonlyArray<OrchestrationV2Run>;

    expect(
      offeredPromptSuggestion({ runId, text: "Run the unit tests next" }, latestRun, runs),
    ).toEqual({ runId, text: "Run the unit tests next" });

    expect(
      offeredPromptSuggestion(
        { runId: "run-old" as RunId, text: "Stale suggestion" },
        latestRun,
        runs,
      ),
    ).toBeNull();
  });
});
