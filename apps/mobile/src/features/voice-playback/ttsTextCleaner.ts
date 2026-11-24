const MAX_TOTAL_TTS_CHARS = 1200;
const TARGET_CHUNK_CHARS = 110;
const MAX_CHUNK_CHARS = 180;
const FRESH_REPLY_GRACE_MS = 5_000;

/**
 * Decides whether a newly-observed completed assistant reply should auto-speak.
 * Historical messages already present before opening/re-entering the thread are skipped.
 */
export function shouldAutoSpeakAssistantMessage(input: {
  readonly messageId: string;
  readonly createdAt: string;
  readonly observedStreaming: boolean;
  readonly screenEnteredAtMs: number;
  readonly alreadyHandled: boolean;
}): boolean {
  if (input.alreadyHandled) return false;
  if (input.observedStreaming) return true;
  const createdMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return createdMs >= input.screenEnteredAtMs - FRESH_REPLY_GRACE_MS;
}

/**
 * Strips code blocks, raw paths, URLs, and Markdown noise so TTS reads only natural prose.
 */
export function cleanMarkdownForTts(markdown: string): string {
  let text = markdown;

  // Remove fenced code blocks completely (```...``` or ~~~...~~~).
  text = text.replace(/```[\s\S]*?```/g, " ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " ");

  // Remove embedded Markdown images / audio (![alt](src)).
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");

  // Convert Markdown links [label](url) to readable label unless the label itself is a raw URL/path.
  text = text.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_match, label: string) => {
    const trimmed = label.trim();
    if (/^(?:https?:\/\/|file:\/\/|[A-Za-z]:\\|\/[\w.-]+\/)/.test(trimmed)) return " ";
    return trimmed;
  });

  // Remove raw URLs and absolute local paths.
  text = text.replace(/https?:\/\/\S+/g, " ");
  text = text.replace(/file:\/\/\S+/g, " ");
  text = text.replace(/[A-Za-z]:\\[^\s,，。；;）】)]+/g, " ");

  // Unwrap inline code spans, dropping long hashes or file paths.
  text = text.replace(/`([^`]+)`/g, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.length > 36 || /[\\/]/.test(trimmed) || /^[0-9a-f]{7,40}$/i.test(trimmed)) {
      return " ";
    }
    return trimmed;
  });

  // Strip Markdown headings, blockquotes, horizontal rules, table pipes, and emphasis markers.
  text = text.replace(/^\s*#{1,6}\s+/gm, "");
  text = text.replace(/^\s*>\s?/gm, "");
  text = text.replace(/^\s*[-*_]{3,}\s*$/gm, " ");
  text = text.replace(/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/gm, " ");
  text = text.replace(/\|/g, "，");
  text = text.replace(/^\s*[-*+•]\s+/gm, "");
  text = text.replace(/[*_~]+/g, "");

  // Normalize line breaks into pauses and collapse excessive spaces.
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\n{2,}/g, "\n");
  text = text.replace(/[ \t]+/g, " ");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("。");

  // Clean up duplicate punctuation produced by stripping blocks.
  text = text.replace(/[。，,]{2,}/g, (match) => (match.includes("。") ? "。" : "，"));
  text = text.replace(/^[\s。，,;；:：-]+/, "").trim();

  if (text.length > MAX_TOTAL_TTS_CHARS) {
    const cut = text.slice(0, MAX_TOTAL_TTS_CHARS);
    const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
    text = lastStop > MAX_TOTAL_TTS_CHARS * 0.5 ? cut.slice(0, lastStop + 1) : `${cut}。`;
  }

  return text;
}

/**
 * Splits cleaned text into natural sentence chunks so the first chunk starts speaking fast
 * while subsequent chunks prefetch in the background.
 */
export function prepareTextForTts(markdown: string): string[] {
  const cleaned = cleanMarkdownForTts(markdown);
  if (cleaned.length === 0) return [];

  const sentences = cleaned
    .split(/(?<=[。！？!?；;])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > MAX_CHUNK_CHARS) {
      pushCurrent();
      let remaining = sentence;
      while (remaining.length > MAX_CHUNK_CHARS) {
        const window = remaining.slice(0, MAX_CHUNK_CHARS);
        const comma = Math.max(window.lastIndexOf("，"), window.lastIndexOf(","));
        const splitAt = comma > 30 ? comma + 1 : MAX_CHUNK_CHARS;
        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
      }
      if (remaining.length > 0) current = remaining;
      continue;
    }

    if (current.length === 0) {
      current = sentence;
      // Keep the very first chunk short so time-to-first-audio feels instant.
      if (chunks.length === 0 && current.length >= 16) {
        pushCurrent();
      }
    } else if (current.length + sentence.length <= TARGET_CHUNK_CHARS) {
      current += sentence;
    } else {
      pushCurrent();
      current = sentence;
    }
  }
  pushCurrent();

  return chunks;
}
