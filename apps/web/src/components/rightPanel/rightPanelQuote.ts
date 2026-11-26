import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";

export type RightPanelChatSource =
  | { readonly kind: "file"; readonly filePath: string }
  | { readonly kind: "web"; readonly url: string; readonly title?: string | undefined };

export interface SelectionAnchorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_MAX_QUOTE_CHARS = 2_000;
const VIEWPORT_PADDING_PX = 8;
const POPOVER_GAP_PX = 8;

export function formatBlockquote(text: string, maxChars = DEFAULT_MAX_QUOTE_CHARS): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized.length === 0) return "";
  const clipped =
    normalized.length > maxChars
      ? `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
      : normalized;
  return clipped
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function formatRightPanelSourceLabel(source: RightPanelChatSource): string {
  if (source.kind === "file") {
    const segments = source.filePath.split(/[\\/]/).filter(Boolean);
    return segments.at(-1) ?? source.filePath;
  }
  const title = source.title?.trim() ?? "";
  if (title.length > 0) return title;
  try {
    const parsed = new URL(source.url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return source.url;
  }
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replace(/[[\]]/g, "\\$&");
}

function formatSourceHeader(source: RightPanelChatSource): string {
  if (source.kind === "file") {
    return serializeComposerFileLink(source.filePath);
  }
  const url = source.url.trim();
  const title = source.title?.trim() ?? "";
  if (title.length > 0 && title !== url) {
    return `[${escapeMarkdownLinkLabel(title)}](${url})`;
  }
  return url;
}

export function formatRightPanelQuoteForChat(input: {
  readonly source: RightPanelChatSource;
  readonly selectedText?: string | undefined;
  readonly question?: string | undefined;
  readonly includeSource?: boolean | undefined;
}): string {
  const includeSource = input.includeSource !== false;
  const header = includeSource ? formatSourceHeader(input.source) : "";
  const quote = input.selectedText ? formatBlockquote(input.selectedText) : "";
  const question = input.question?.trim() ?? "";

  if (quote.length > 0) {
    const quotedBlock = header.length > 0 ? `${header}\n${quote}` : quote;
    return question.length > 0 ? `${quotedBlock}\n\n${question}` : `${quotedBlock}\n\n`;
  }
  if (question.length > 0) {
    return header.length > 0 ? `${header} ${question}` : question;
  }
  return header.length > 0 ? `${header} ` : "";
}

export function computeSelectionPopoverPosition(
  anchor: SelectionAnchorRect,
  viewport: { readonly width: number; readonly height: number },
  popover: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number } {
  const maxLeft = Math.max(
    VIEWPORT_PADDING_PX,
    viewport.width - popover.width - VIEWPORT_PADDING_PX,
  );
  const centeredLeft = anchor.x + anchor.width / 2 - popover.width / 2;
  const left = Math.min(maxLeft, Math.max(VIEWPORT_PADDING_PX, centeredLeft));

  const aboveTop = anchor.y - popover.height - POPOVER_GAP_PX;
  const belowTop = anchor.y + anchor.height + POPOVER_GAP_PX;
  const maxTop = Math.max(
    VIEWPORT_PADDING_PX,
    viewport.height - popover.height - VIEWPORT_PADDING_PX,
  );
  const preferredTop = aboveTop >= VIEWPORT_PADDING_PX ? aboveTop : belowTop;
  const top = Math.min(maxTop, Math.max(VIEWPORT_PADDING_PX, preferredTop));

  return { left: Math.round(left), top: Math.round(top) };
}
