const MAX_TOTAL_TTS_CHARS = 1200;
const TARGET_CHUNK_CHARS = 110;
const MAX_CHUNK_CHARS = 180;
const FRESH_REPLY_GRACE_MS = 5_000;
const MIN_STREAMING_FIRST_CHUNK_CHARS = 10;
const MIN_STREAMING_NEXT_CHUNK_CHARS = 24;

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
export function cleanMarkdownForTts(markdown: string, maxChars = MAX_TOTAL_TTS_CHARS): string {
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

  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
    text = lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : `${cut}。`;
  }

  return text;
}

/**
 * Splits cleaned text into natural sentence chunks so the first chunk starts speaking fast
 * while subsequent chunks prefetch in the background.
 */
export function prepareTextForTts(markdown: string, maxChars = MAX_TOTAL_TTS_CHARS): string[] {
  const cleaned = cleanMarkdownForTts(markdown, maxChars);
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

function hasUnclosedInlineSyntax(segment: string): boolean {
  const backticks = (segment.match(/`/g) ?? []).length;
  if (backticks % 2 === 1) return true;
  const openBrackets = (segment.match(/\[/g) ?? []).length;
  const closeBrackets = (segment.match(/\]/g) ?? []).length;
  if (openBrackets > closeBrackets) return true;
  // Unfinished markdown link `](` without closing `)`
  const linkStart = segment.lastIndexOf("](");
  if (linkStart !== -1 && segment.indexOf(")", linkStart + 2) === -1) return true;
  return false;
}

function findLastSentenceBoundary(segment: string): number {
  let last = -1;
  const regex = /[。！？!?；;]|(?:\r?\n){2,}|\r?\n/g;
  let match = regex.exec(segment);
  while (match !== null) {
    const end = match.index + match[0].length;
    // Avoid splitting right after a bare list marker like "1." or "- "
    const candidate = segment.slice(0, end);
    if (!hasUnclosedInlineSyntax(candidate)) {
      last = end;
    }
    match = regex.exec(segment);
  }
  return last;
}

/**
 * Incrementally extracts ready-to-speak prose chunks from a streaming Markdown reply.
 * Holds back unclosed fenced code blocks and incomplete sentences so audio starts as soon
 * as the first complete sentence arrives, without reading raw code or choppy fragments.
 */
export function extractStreamingTtsChunks(input: {
  readonly rawMarkdown: string;
  readonly consumedRawIndex: number;
  readonly streaming: boolean;
  readonly alreadySpokenChars: number;
}): {
  readonly chunks: string[];
  readonly nextRawIndex: number;
  readonly addedSpokenChars: number;
} {
  const remainingBudget = MAX_TOTAL_TTS_CHARS - input.alreadySpokenChars;
  if (remainingBudget <= 0) {
    return {
      chunks: [],
      nextRawIndex: input.rawMarkdown.length,
      addedSpokenChars: 0,
    };
  }

  if (!input.streaming) {
    const tail = input.rawMarkdown.slice(input.consumedRawIndex);
    const chunks = prepareTextForTts(tail, remainingBudget);
    const addedSpokenChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    return {
      chunks,
      nextRawIndex: input.rawMarkdown.length,
      addedSpokenChars,
    };
  }

  let cursor = input.consumedRawIndex;
  const emitted: string[] = [];
  let added = 0;

  while (cursor < input.rawMarkdown.length && added < remainingBudget) {
    const before = input.rawMarkdown.slice(0, cursor);
    const fenceCountBefore = (before.match(/```/g) ?? []).length;
    const rest = input.rawMarkdown.slice(cursor);

    // Inside an open fenced code block: wait until the closing ``` arrives, then skip it.
    if (fenceCountBefore % 2 === 1) {
      const closeIdx = rest.indexOf("```");
      if (closeIdx === -1) break;
      cursor += closeIdx + 3;
      continue;
    }

    // Look for the next opening code fence. Process only prose before it.
    const nextFenceIdx = rest.indexOf("```");
    const proseSlice = nextFenceIdx === -1 ? rest : rest.slice(0, nextFenceIdx);
    const boundary = findLastSentenceBoundary(proseSlice);

    if (boundary === -1) {
      // If a complete code fence starts immediately after short/empty prose, consume the prose + open fence
      // only if the closing fence is also already present.
      if (nextFenceIdx !== -1) {
        const afterOpen = rest.slice(nextFenceIdx + 3);
        const closeIdx = afterOpen.indexOf("```");
        if (closeIdx !== -1) {
          const preChunks = prepareTextForTts(proseSlice, remainingBudget - added);
          for (const chunk of preChunks) {
            emitted.push(chunk);
            added += chunk.length;
          }
          cursor += nextFenceIdx + 3 + closeIdx + 3;
          continue;
        }
      }
      break;
    }

    const candidateRaw = proseSlice.slice(0, boundary);
    const cleaned = cleanMarkdownForTts(candidateRaw, remainingBudget - added);
    const minChars =
      input.alreadySpokenChars + added === 0
        ? MIN_STREAMING_FIRST_CHUNK_CHARS
        : MIN_STREAMING_NEXT_CHUNK_CHARS;
    const isParagraphBreak = /\r?\n\s*\r?\n/.test(candidateRaw);

    if (cleaned.length === 0) {
      cursor += boundary;
      continue;
    }

    if (cleaned.length < minChars && !isParagraphBreak && nextFenceIdx === -1) {
      break;
    }

    const chunks = prepareTextForTts(candidateRaw, remainingBudget - added);
    for (const chunk of chunks) {
      emitted.push(chunk);
      added += chunk.length;
    }
    cursor += boundary;
  }

  return {
    chunks: emitted,
    nextRawIndex: cursor,
    addedSpokenChars: added,
  };
}
