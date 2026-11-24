import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom } from "../../state/preferences";
import { DEFAULT_TTS_VOICE_ID } from "./ttsVoices";
import { shouldAutoSpeakAssistantMessage } from "./ttsTextCleaner";
import { speakMessage, stopSpeaking } from "./voicePlaybackStore";

/**
 * Session-wide deduplication so returning to a thread (or remounting after switching apps)
 * NEVER auto-speaks a message a second time.
 */
const handledAssistantMessageIds = new Set<string>();

/**
 * Automatically speaks ONLY live, newly-completed assistant replies while the user is actively
 * viewing this thread. Never reads historical messages on open, hydration, or returning to a thread,
 * and always stops immediately when switching threads, leaving the screen, backgrounding, or sending.
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
    userMessageCount: number | null;
  }>({
    threadKey: "",
    enteredAtMs: 0,
    observedStreamingIds: new Set(),
    userMessageCount: null,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resets per-thread tracking and stops any previous thread's audio on switch or unmount
  useEffect(() => {
    threadSessionRef.current = {
      threadKey: input.threadKey,
      enteredAtMs: Date.now(),
      observedStreamingIds: new Set(),
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches live assistant replies to auto-speak once on completion
  useEffect(() => {
    const session = threadSessionRef.current;
    if (session.threadKey !== input.threadKey) return;

    let userMessages = 0;
    let messageToSpeak: { readonly id: string; readonly text: string } | null = null;

    for (const entry of input.feed) {
      if (entry.type !== "message") continue;
      if (entry.message.role === "user") {
        userMessages += 1;
        continue;
      }
      if (entry.message.role !== "assistant") continue;
      if (entry.message.streaming) {
        session.observedStreamingIds.add(entry.message.id);
        continue;
      }

      const alreadyHandled = handledAssistantMessageIds.has(entry.message.id);
      if (alreadyHandled) continue;

      const eligible = shouldAutoSpeakAssistantMessage({
        messageId: entry.message.id,
        createdAt: entry.message.createdAt,
        observedStreaming: session.observedStreamingIds.has(entry.message.id),
        screenEnteredAtMs: session.enteredAtMs,
        alreadyHandled,
      });

      // Mark every completed message as handled on first sight so re-entering or toggling
      // auto-play later never retroactively reads older replies.
      handledAssistantMessageIds.add(entry.message.id);

      if (eligible && autoPlay && isFocused && entry.message.text.trim().length > 0) {
        messageToSpeak = { id: entry.message.id, text: entry.message.text };
      }
    }

    // Stop speaking if the user sends a new follow-up message in this thread.
    if (session.userMessageCount !== null && userMessages > session.userMessageCount) {
      stopSpeaking();
    }
    session.userMessageCount = userMessages;

    if (messageToSpeak) {
      void speakMessage({
        messageId: messageToSpeak.id,
        text: messageToSpeak.text,
        voiceId,
        silentOnMissingKey: true,
      });
    }
  }, [input.threadKey, input.feed, autoPlay, voiceId, isFocused]);
}
