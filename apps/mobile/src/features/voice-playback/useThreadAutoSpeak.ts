import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom } from "../../state/preferences";
import { extractStreamingTtsChunks, shouldAutoSpeakAssistantMessage } from "./ttsTextCleaner";
import { DEFAULT_TTS_VOICE_ID } from "./ttsVoices";
import {
  appendStreamingSpeechChunks,
  isMessageStreamSuppressed,
  speakMessage,
  stopSpeaking,
  suppressMessageStream,
} from "./voicePlaybackStore";

/**
 * Session-wide deduplication so returning to a thread (or remounting after switching apps)
 * NEVER auto-speaks a message a second time.
 */
const handledAssistantMessageIds = new Set<string>();

interface StreamCursor {
  rawIndex: number;
  spokenChars: number;
  started: boolean;
}

/**
 * Automatically speaks live assistant replies sentence-by-sentence while streaming (Doubao-style).
 * Never reads historical messages on open, hydration, or returning to a thread, and stops
 * immediately when switching threads, leaving the screen, backgrounding, or sending a follow-up.
 */
export function useThreadAutoSpeak(input: {
  readonly threadKey: string;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
}) {
  const isFocused = useIsFocused();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const autoPlay = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.ttsAutoPlay === true
    : false;
  const voiceId = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.ttsVoiceId ?? DEFAULT_TTS_VOICE_ID)
    : DEFAULT_TTS_VOICE_ID;

  const threadSessionRef = useRef<{
    threadKey: string;
    enteredAtMs: number;
    observedStreamingIds: Set<string>;
    streamCursors: Map<string, StreamCursor>;
    userMessageCount: number | null;
  }>({
    threadKey: "",
    enteredAtMs: 0,
    observedStreamingIds: new Set(),
    streamCursors: new Map(),
    userMessageCount: null,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets per-thread tracking and stops any previous thread's audio on switch or unmount
  useEffect(() => {
    threadSessionRef.current = {
      threadKey: input.threadKey,
      enteredAtMs: Date.now(),
      observedStreamingIds: new Set(),
      streamCursors: new Map(),
      userMessageCount: null,
    };
    stopSpeaking();
    return () => {
      stopSpeaking();
    };
  }, [input.threadKey]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops playback immediately when leaving the thread screen
  useEffect(() => {
    if (!isFocused) stopSpeaking();
  }, [isFocused]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops playback when the app moves to background
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") stopSpeaking();
    });
    return () => subscription.remove();
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- streams sentence chunks to TTS live while the assistant is typing
  useEffect(() => {
    const session = threadSessionRef.current;
    if (session.threadKey !== input.threadKey) return;

    let userMessages = 0;
    const streamingMessages: Array<{ readonly id: string; readonly text: string }> = [];
    const completedMessages: Array<{
      readonly id: string;
      readonly text: string;
      readonly createdAt: string;
    }> = [];

    for (const entry of input.feed) {
      if (entry.type !== "message") continue;
      if (entry.message.role === "user") {
        userMessages += 1;
        continue;
      }
      if (entry.message.role !== "assistant") continue;
      if (entry.message.streaming) {
        session.observedStreamingIds.add(entry.message.id);
        streamingMessages.push({ id: entry.message.id, text: entry.message.text });
      } else {
        completedMessages.push({
          id: entry.message.id,
          text: entry.message.text,
          createdAt: entry.message.createdAt,
        });
      }
    }

    // Stop speaking if the user sends a new follow-up message in this thread.
    if (session.userMessageCount !== null && userMessages > session.userMessageCount) {
      for (const msg of streamingMessages) suppressMessageStream(msg.id);
      stopSpeaking();
    }
    session.userMessageCount = userMessages;

    // 1. Handle live streaming assistant reply (speak sentence-by-sentence as it arrives).
    const activeStreaming = streamingMessages[streamingMessages.length - 1];
    if (
      activeStreaming &&
      autoPlay &&
      isFocused &&
      !handledAssistantMessageIds.has(activeStreaming.id) &&
      !isMessageStreamSuppressed(activeStreaming.id)
    ) {
      let cursor = session.streamCursors.get(activeStreaming.id);
      if (!cursor) {
        cursor = { rawIndex: 0, spokenChars: 0, started: false };
        session.streamCursors.set(activeStreaming.id, cursor);
      }
      const extracted = extractStreamingTtsChunks({
        rawMarkdown: activeStreaming.text,
        consumedRawIndex: cursor.rawIndex,
        streaming: true,
        alreadySpokenChars: cursor.spokenChars,
      });
      if (extracted.nextRawIndex > cursor.rawIndex) {
        cursor.rawIndex = extracted.nextRawIndex;
        cursor.spokenChars += extracted.addedSpokenChars;
      }
      if (extracted.chunks.length > 0) {
        cursor.started = true;
        void appendStreamingSpeechChunks({
          messageId: activeStreaming.id,
          voiceId,
          chunks: extracted.chunks,
          ended: false,
          silentOnMissingKey: true,
        });
      }
    }

    // 2. Handle completed messages: flush active stream tail OR speak fresh fast-completed reply.
    let freshCompletedToSpeak: { readonly id: string; readonly text: string } | null = null;
    for (const msg of completedMessages) {
      const alreadyHandled = handledAssistantMessageIds.has(msg.id);
      if (alreadyHandled) continue;

      const cursor = session.streamCursors.get(msg.id);
      handledAssistantMessageIds.add(msg.id);

      if (cursor?.started) {
        session.streamCursors.delete(msg.id);
        if (autoPlay && isFocused && !isMessageStreamSuppressed(msg.id)) {
          const tail = extractStreamingTtsChunks({
            rawMarkdown: msg.text,
            consumedRawIndex: cursor.rawIndex,
            streaming: false,
            alreadySpokenChars: cursor.spokenChars,
          });
          void appendStreamingSpeechChunks({
            messageId: msg.id,
            voiceId,
            chunks: tail.chunks,
            ended: true,
            silentOnMissingKey: true,
          });
        }
        continue;
      }

      session.streamCursors.delete(msg.id);
      const eligible = shouldAutoSpeakAssistantMessage({
        messageId: msg.id,
        createdAt: msg.createdAt,
        observedStreaming: session.observedStreamingIds.has(msg.id),
        screenEnteredAtMs: session.enteredAtMs,
        alreadyHandled: false,
      });
      if (eligible && autoPlay && isFocused && msg.text.trim().length > 0) {
        freshCompletedToSpeak = { id: msg.id, text: msg.text };
      }
    }

    if (freshCompletedToSpeak && !isMessageStreamSuppressed(freshCompletedToSpeak.id)) {
      void speakMessage({
        messageId: freshCompletedToSpeak.id,
        text: freshCompletedToSpeak.text,
        voiceId,
        silentOnMissingKey: true,
      });
    }
  }, [input.threadKey, input.feed, autoPlay, voiceId, isFocused]);
}
