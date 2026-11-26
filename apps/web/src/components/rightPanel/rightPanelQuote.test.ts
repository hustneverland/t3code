import { describe, expect, it } from "vite-plus/test";
import {
  computeSelectionPopoverPosition,
  formatBlockquote,
  formatRightPanelQuoteForChat,
  formatRightPanelSourceLabel,
} from "./rightPanelQuote";

describe("rightPanelQuote", () => {
  it("formats multiline blockquotes cleanly and clips long excerpts", () => {
    expect(formatBlockquote("line 1\r\n\r\nline 2")).toBe("> line 1\n>\n> line 2");
    expect(formatBlockquote("abcdef", 4)).toBe("> abc…");
  });

  it("formats file quotes and follow-up questions with composer file links", () => {
    expect(
      formatRightPanelQuoteForChat({
        source: { kind: "file", filePath: "docs/report.md" },
      }),
    ).toBe("[report.md](docs/report.md) ");

    expect(
      formatRightPanelQuoteForChat({
        source: { kind: "file", filePath: "docs/my report.md" },
        selectedText: "Total revenue grew 20%",
      }),
    ).toBe("[my report.md](docs/my%20report.md)\n> Total revenue grew 20%\n\n");

    expect(
      formatRightPanelQuoteForChat({
        source: { kind: "file", filePath: "docs/report.md" },
        selectedText: "Total revenue grew 20%",
        question: "请核对一下分母口径",
      }),
    ).toBe("[report.md](docs/report.md)\n> Total revenue grew 20%\n\n请核对一下分母口径");

    expect(
      formatRightPanelQuoteForChat({
        source: { kind: "file", filePath: "docs/report.md" },
        question: "帮我总结这个文档",
      }),
    ).toBe("[report.md](docs/report.md) 帮我总结这个文档");

    expect(
      formatRightPanelQuoteForChat({
        source: { kind: "file", filePath: "docs/report.md" },
        question: "直接接着聊",
        includeSource: false,
      }),
    ).toBe("直接接着聊");
  });

  it("formats webpage quotes and labels cleanly", () => {
    expect(
      formatRightPanelSourceLabel({
        kind: "web",
        url: "https://example.com/docs/intro",
        title: "Intro Guide",
      }),
    ).toBe("Intro Guide");

    expect(
      formatRightPanelSourceLabel({
        kind: "web",
        url: "https://example.com/docs/intro",
      }),
    ).toBe("example.com/docs/intro");

    expect(
      formatRightPanelQuoteForChat({
        source: {
          kind: "web",
          url: "https://example.com/docs/intro",
          title: "Intro [v2]",
        },
        question: "这里第三点什么意思",
      }),
    ).toBe("[Intro \\[v2\\]](https://example.com/docs/intro) 这里第三点什么意思");
  });

  it("places the selection popover above the selection and flips below near the top edge", () => {
    expect(
      computeSelectionPopoverPosition(
        { x: 400, y: 200, width: 120, height: 20 },
        { width: 1200, height: 800 },
        { width: 200, height: 36 },
      ),
    ).toEqual({ left: 360, top: 156 });

    expect(
      computeSelectionPopoverPosition(
        { x: 10, y: 12, width: 80, height: 20 },
        { width: 1200, height: 800 },
        { width: 200, height: 36 },
      ),
    ).toEqual({ left: 8, top: 40 });
  });
});
