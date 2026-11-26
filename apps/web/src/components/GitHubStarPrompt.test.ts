import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { recordPromptSent } from "./GitHubStarPrompt";

describe("recordPromptSent", () => {
  it("is a no-op in personal builds", async () => {
    await expect(recordPromptSent(EnvironmentId.make("environment-1"))).resolves.toBeUndefined();
  });
});
