import { describe, expect, it } from "vite-plus/test";

import {
  cleanMarkdownForTts,
  prepareTextForTts,
  shouldAutoSpeakAssistantMessage,
} from "./ttsTextCleaner";

describe("ttsTextCleaner", () => {
  it("strips code fences, embeds, URLs, and raw file paths while keeping readable prose", () => {
    const input = [
      "### 改好啦！",
      "![预览图](C:/Users/demo/preview.png)",
      "我已经修好了 [SettingsAboutRouteScreen.tsx](file:///D:/repo/a.tsx) 和 `src/a/b.ts`。",
      "```ts",
      "const secret = 123;",
      "```",
      "直接打开 https://example.com/foo 就能看效果喔！",
    ].join("\n");

    const cleaned = cleanMarkdownForTts(input);
    expect(cleaned).toContain("改好啦！");
    expect(cleaned).toContain("直接打开 就能看效果喔！");
    expect(cleaned).not.toContain("const secret");
    expect(cleaned).not.toContain("https://");
    expect(cleaned).not.toContain("file://");
    expect(cleaned).not.toContain("src/a/b.ts");
  });

  it("keeps the first chunk short for fast time-to-first-audio", () => {
    const input =
      "哈喽哥哥，第一句已经准备好了，马上开始念给你听喔！第二句会紧接着在后台提前合成，所以听起来会非常顺滑连贯，完全不会卡顿。第三句也会自动排在后面继续播报。";
    const chunks = prepareTextForTts(input);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe("哈喽哥哥，第一句已经准备好了，马上开始念给你听喔！");
  });

  it("never auto-speaks historical messages on open or repeat messages on re-enter", () => {
    const enteredAt = 1_700_000_000_000;
    // Old message from 30 seconds before opening the thread -> must NOT auto-speak
    expect(
      shouldAutoSpeakAssistantMessage({
        messageId: "m-old",
        createdAt: new Date(enteredAt - 30_000).toISOString(),
        observedStreaming: false,
        screenEnteredAtMs: enteredAt,
        alreadyHandled: false,
      }),
    ).toBe(false);

    // Live message observed streaming -> MUST auto-speak once
    expect(
      shouldAutoSpeakAssistantMessage({
        messageId: "m-live",
        createdAt: new Date(enteredAt - 20_000).toISOString(),
        observedStreaming: true,
        screenEnteredAtMs: enteredAt,
        alreadyHandled: false,
      }),
    ).toBe(true);

    // Same message after returning to the thread -> must NOT replay
    expect(
      shouldAutoSpeakAssistantMessage({
        messageId: "m-live",
        createdAt: new Date(enteredAt + 2_000).toISOString(),
        observedStreaming: true,
        screenEnteredAtMs: enteredAt,
        alreadyHandled: true,
      }),
    ).toBe(false);
  });
});
