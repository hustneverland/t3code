import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

import {
  acquireAudioSession,
  activateAudioSession,
  disposeAudioPlayer,
  isAudioSessionOwner,
  pauseAudioPlayer,
  releaseAudioSession,
} from "../../lib/audioSession";
import { prepareTextForTts } from "./ttsTextCleaner";
import { resolveTtsVoice } from "./ttsVoices";

const VOLCENGINE_TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const API_KEY_STORAGE_KEY = "xingye.volcengine.tts.apiKey";
const TTS_CACHE_DIR_NAME = "xingye-tts";
const PREVIEW_SAMPLE_TEXT =
  "哈喽，我是星野语音小助手喔！以后你问问题，我就会这样轻轻念给你听，是不是很舒服呀？";

export interface VoicePlaybackSnapshot {
  readonly status: "idle" | "loading" | "playing";
  readonly messageId: string | null;
  readonly error: string | null;
  readonly apiKeyConfigured: boolean | null;
}

interface ActiveStreamQueue {
  readonly messageId: string;
  readonly generation: number;
  readonly apiKey: string;
  readonly voiceId: string;
  readonly controller: AbortController;
  readonly pendingTexts: string[];
  readonly prefetched: Array<{
    readonly promise: Promise<File>;
  }>;
  nextChunkIndex: number;
  ended: boolean;
  wake: (() => void) | null;
}

let snapshot: VoicePlaybackSnapshot = {
  status: "idle",
  messageId: null,
  error: null,
  apiKeyConfigured: null,
};

let cachedApiKey: string | null | undefined;
let playbackGeneration = 0;
let activeAbortController: AbortController | null = null;
let activePlayer: AudioPlayer | null = null;
let activePlayerSubscription: { remove(): void } | null = null;
let activeSessionToken: ReturnType<typeof acquireAudioSession> | null = null;
let activeResolveWait: (() => void) | null = null;
let activeStream: ActiveStreamQueue | null = null;

/** Message IDs explicitly stopped by the user mid-stream so later tokens never restart speech. */
const suppressedStreamMessageIds = new Set<string>();

const listeners = new Set<() => void>();

function emitSnapshot(patch: Partial<VoicePlaybackSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeVoicePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVoicePlaybackSnapshot(): VoicePlaybackSnapshot {
  return snapshot;
}

export function useVoicePlaybackSnapshot(): VoicePlaybackSnapshot {
  return useSyncExternalStore(
    subscribeVoicePlayback,
    getVoicePlaybackSnapshot,
    getVoicePlaybackSnapshot,
  );
}

export function isMessageStreamSuppressed(messageId: string): boolean {
  return suppressedStreamMessageIds.has(messageId);
}

export function suppressMessageStream(messageId: string): void {
  suppressedStreamMessageIds.add(messageId);
}

export async function loadVolcengineTtsApiKey(): Promise<string | null> {
  if (cachedApiKey !== undefined) {
    if (snapshot.apiKeyConfigured === null) {
      emitSnapshot({ apiKeyConfigured: Boolean(cachedApiKey) });
    }
    return cachedApiKey;
  }
  try {
    const stored = await SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
    cachedApiKey = stored?.trim() || null;
  } catch {
    cachedApiKey = null;
  }
  emitSnapshot({ apiKeyConfigured: Boolean(cachedApiKey) });
  return cachedApiKey;
}

export async function saveVolcengineTtsApiKey(rawKey: string): Promise<void> {
  const trimmed = rawKey.trim();
  if (trimmed.length === 0) {
    await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
    cachedApiKey = null;
    emitSnapshot({ apiKeyConfigured: false, error: null });
    return;
  }
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, trimmed);
  cachedApiKey = trimmed;
  emitSnapshot({ apiKeyConfigured: true, error: null });
}

const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(128).fill(255);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i += 1) {
    table[alphabet.charCodeAt(i)] = i;
  }
  return table;
})();

function decodeBase64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  if (clean.length === 0) return new Uint8Array(0);
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  const outLength = Math.floor((clean.length * 3) / 4) - padding;
  const bytes = new Uint8Array(Math.max(0, outLength));
  let out = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)] ?? 0;
    const b = BASE64_LOOKUP[clean.charCodeAt(i + 1)] ?? 0;
    const c = clean[i + 2] === "=" ? 0 : (BASE64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0);
    const d = clean[i + 3] === "=" ? 0 : (BASE64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0);
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (out < bytes.length) bytes[out++] = (triple >> 16) & 0xff;
    if (out < bytes.length) bytes[out++] = (triple >> 8) & 0xff;
    if (out < bytes.length) bytes[out++] = triple & 0xff;
  }
  return bytes;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function ensureCacheDir(): Directory {
  const dir = new Directory(Paths.cache, TTS_CACHE_DIR_NAME);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

function safeDeleteFile(file: File | null) {
  if (!file) return;
  try {
    if (file.exists) file.delete();
  } catch {}
}

async function synthesizeChunkToFile(input: {
  readonly apiKey: string;
  readonly text: string;
  readonly voiceId: string;
  readonly generation: number;
  readonly chunkIndex: number;
  readonly signal: AbortSignal;
}): Promise<File> {
  const voice = resolveTtsVoice(input.voiceId);
  const response = await fetch(VOLCENGINE_TTS_URL, {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "X-Api-Resource-Id": voice.resourceId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      req_params: {
        text: input.text,
        speaker: voice.speaker,
        audio_params: {
          format: "mp3",
          sample_rate: 24000,
        },
      },
    }),
    signal: input.signal,
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Volcengine TTS HTTP ${response.status}: ${bodyText.slice(0, 160)}`);
  }

  const audioParts: Uint8Array[] = [];
  let apiError: string | null = null;
  for (const rawLine of bodyText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as {
        readonly code?: number;
        readonly message?: string;
        readonly data?: string;
      };
      if (typeof parsed.data === "string" && parsed.data.length > 0) {
        audioParts.push(decodeBase64ToBytes(parsed.data));
      } else if (typeof parsed.code === "number" && parsed.code !== 0 && parsed.code !== 20000000) {
        apiError = parsed.message || `TTS error ${parsed.code}`;
      }
    } catch {}
  }

  const bytes = concatBytes(audioParts);
  if (bytes.length === 0) {
    throw new Error(apiError ?? "Empty audio response from Volcengine TTS");
  }

  const dir = ensureCacheDir();
  const file = new File(dir, `tts-${input.generation}-${input.chunkIndex}.mp3`);
  file.write(bytes);
  return file;
}

function cleanupActivePlayer() {
  activePlayerSubscription?.remove();
  activePlayerSubscription = null;
  const player = activePlayer;
  activePlayer = null;
  if (player) {
    disposeAudioPlayer(player);
  }
  const resolveWait = activeResolveWait;
  activeResolveWait = null;
  resolveWait?.();
}

function releaseActiveSession() {
  const token = activeSessionToken;
  activeSessionToken = null;
  if (token) {
    void releaseAudioSession(token).catch(() => {});
  }
}

export function stopSpeaking(): void {
  if (activeStream) {
    suppressedStreamMessageIds.add(activeStream.messageId);
    const wake = activeStream.wake;
    activeStream.wake = null;
    activeStream = null;
    wake?.();
  } else if (snapshot.messageId) {
    suppressedStreamMessageIds.add(snapshot.messageId);
  }
  playbackGeneration += 1;
  activeAbortController?.abort();
  activeAbortController = null;
  cleanupActivePlayer();
  releaseActiveSession();
  if (snapshot.status !== "idle" || snapshot.messageId !== null) {
    emitSnapshot({ status: "idle", messageId: null });
  }
}

async function playAudioFile(file: File, generation: number): Promise<void> {
  if (generation !== playbackGeneration) return;
  const player = createAudioPlayer(file.uri, { updateInterval: 150 });
  activePlayer = player;

  if (!activeSessionToken || !isAudioSessionOwner(activeSessionToken)) {
    const token = acquireAudioSession(
      "playback",
      () => {
        if (generation === playbackGeneration) stopSpeaking();
      },
      () => {
        try {
          pauseAudioPlayer(player);
        } catch {}
      },
    );
    activeSessionToken = token;
    const activated = await activateAudioSession(token);
    if (!activated || generation !== playbackGeneration) {
      cleanupActivePlayer();
      return;
    }
  }

  await new Promise<void>((resolve) => {
    if (generation !== playbackGeneration) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      activeResolveWait = null;
      activePlayerSubscription?.remove();
      activePlayerSubscription = null;
      if (activePlayer === player) {
        activePlayer = null;
        disposeAudioPlayer(player);
      }
      resolve();
    };
    activeResolveWait = finish;
    activePlayerSubscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.didJustFinish || status.error) {
        finish();
      }
    });
    emitSnapshot({ status: "playing", error: null });
    try {
      player.play();
    } catch {
      finish();
    }
  });
}

function pumpStreamPrefetch(stream: ActiveStreamQueue) {
  while (stream.prefetched.length < 2 && stream.pendingTexts.length > 0) {
    const text = stream.pendingTexts.shift()!;
    const chunkIndex = stream.nextChunkIndex;
    stream.nextChunkIndex += 1;
    const promise = synthesizeChunkToFile({
      apiKey: stream.apiKey,
      text,
      voiceId: stream.voiceId,
      generation: stream.generation,
      chunkIndex,
      signal: stream.controller.signal,
    });
    // Attach a noop rejection handler so aborted prefetches never emit unhandledRejection.
    void promise.catch(() => {});
    stream.prefetched.push({ promise });
  }
}

async function runStreamLoop(stream: ActiveStreamQueue): Promise<void> {
  const tempFiles: File[] = [];
  try {
    while (stream.generation === playbackGeneration && activeStream === stream) {
      pumpStreamPrefetch(stream);
      const nextItem = stream.prefetched.shift();
      if (!nextItem) {
        if (stream.ended) break;
        await new Promise<void>((resolve) => {
          stream.wake = resolve;
        });
        stream.wake = null;
        continue;
      }

      const file = await nextItem.promise;
      tempFiles.push(file);
      if (stream.generation !== playbackGeneration || activeStream !== stream) break;

      // Kick off prefetch for the next queued sentence before starting playback.
      pumpStreamPrefetch(stream);
      await playAudioFile(file, stream.generation);
      safeDeleteFile(file);
    }

    if (stream.generation === playbackGeneration && activeStream === stream) {
      activeStream = null;
      releaseActiveSession();
      emitSnapshot({ status: "idle", messageId: null, error: null });
    }
  } catch (error) {
    if (
      stream.generation === playbackGeneration &&
      activeStream === stream &&
      !stream.controller.signal.aborted
    ) {
      const message = error instanceof Error ? error.message : String(error);
      activeStream = null;
      releaseActiveSession();
      emitSnapshot({ status: "idle", messageId: null, error: message });
    }
  } finally {
    if (activeAbortController === stream.controller) {
      activeAbortController = null;
    }
    for (const file of tempFiles) safeDeleteFile(file);
  }
}

/**
 * Starts or appends to a live sentence-by-sentence streaming TTS queue for a message.
 * Allows audio playback to begin as soon as the first sentence finishes streaming.
 */
export async function appendStreamingSpeechChunks(input: {
  readonly messageId: string;
  readonly voiceId: string;
  readonly chunks: readonly string[];
  readonly ended: boolean;
  readonly silentOnMissingKey?: boolean;
}): Promise<boolean> {
  if (suppressedStreamMessageIds.has(input.messageId)) return false;

  if (activeStream && activeStream.messageId === input.messageId) {
    for (const chunk of input.chunks) {
      if (chunk.trim().length > 0) activeStream.pendingTexts.push(chunk);
    }
    if (input.ended) activeStream.ended = true;
    pumpStreamPrefetch(activeStream);
    const wake = activeStream.wake;
    activeStream.wake = null;
    wake?.();
    return true;
  }

  if (input.chunks.length === 0) return false;

  const apiKey = await loadVolcengineTtsApiKey();
  if (!apiKey) {
    if (!input.silentOnMissingKey) {
      emitSnapshot({
        status: "idle",
        messageId: null,
        // oxlint-disable-next-line t3code/no-untranslated-copy -- Personal Xingye Chinese TTS setup prompt
        error: "请先在「设置 → 语音」中填写火山引擎 API Key",
      });
    }
    return false;
  }

  // Re-check suppression after async key lookup.
  if (suppressedStreamMessageIds.has(input.messageId)) return false;

  stopSpeaking();
  // Starting this message clears any prior suppression on itself only when explicitly new.
  suppressedStreamMessageIds.delete(input.messageId);
  const generation = playbackGeneration;
  const controller = new AbortController();
  activeAbortController = controller;
  emitSnapshot({ status: "loading", messageId: input.messageId, error: null });

  const stream: ActiveStreamQueue = {
    messageId: input.messageId,
    generation,
    apiKey,
    voiceId: input.voiceId,
    controller,
    pendingTexts: input.chunks.filter((chunk) => chunk.trim().length > 0),
    prefetched: [],
    nextChunkIndex: 0,
    ended: input.ended,
    wake: null,
  };
  activeStream = stream;
  void runStreamLoop(stream);
  return true;
}

export async function speakMessage(input: {
  readonly messageId: string;
  readonly text: string;
  readonly voiceId: string;
  readonly silentOnMissingKey?: boolean;
}): Promise<boolean> {
  // Explicit manual play clears any previous suppression for this message.
  suppressedStreamMessageIds.delete(input.messageId);
  const chunks = prepareTextForTts(input.text);
  if (chunks.length === 0) return false;
  return appendStreamingSpeechChunks({
    messageId: input.messageId,
    voiceId: input.voiceId,
    chunks,
    ended: true,
    silentOnMissingKey: input.silentOnMissingKey,
  });
}

export async function speakVoicePreview(voiceId: string): Promise<boolean> {
  return speakMessage({
    messageId: `preview:${voiceId}`,
    text: PREVIEW_SAMPLE_TEXT,
    voiceId,
  });
}
