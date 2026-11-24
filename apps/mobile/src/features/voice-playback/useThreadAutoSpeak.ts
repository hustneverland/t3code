import { useAtomValue } from "@effect/atom-react";
import { useIsFocused } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";

import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom } from "../../state/preferences";
import { DEFAULT_TTS_VOICE_ID } from "./ttsVoices";
import { speakMessage, stopSpeaking } from "./voicePlaybackStore";

/**
 * Automatically speaks newly completed assistant replies in the active thread when auto-play
 * is enabled, without replaying historical messages already present when the thread opens.
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

  const seededThreadRef = useRef<string | null>(null);
  const seenCompletedIdsRef = useRef<Set<string>>(new Set());

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops playback when leaving the thread screen
  useEffect(() => {
    if (!isFocused) stopSpeaking();
  }, [isFocused]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes completed assistant replies to trigger TTS playback
  useEffect(() => {
    if (seededThreadRef.current !== input.threadKey) {
      seededThreadRef.current = input.threadKey;
      const seeded = new Set<string>();
      for (const entry of input.feed) {
        if (
          entry.type === "message" &&
          entry.message.role === "assistant" &&
          !entry.message.streaming
        ) {
          seeded.add(entry.message.id);
        }
      }
      seenCompletedIdsRef.current = seeded;
      return;
    }

    let latestNewMessage: { readonly id: string; readonly text: string } | null = null;
    for (const entry of input.feed) {
      if (entry.type !== "message" || entry.message.role !== "assistant") continue;
      if (entry.message.streaming) continue;
      if (seenCompletedIdsRef.current.has(entry.message.id)) continue;
      seenCompletedIdsRef.current.add(entry.message.id);
      if (entry.message.text.trim().length > 0) {
        latestNewMessage = { id: entry.message.id, text: entry.message.text };
      }
    }

    if (latestNewMessage && autoPlay && isFocused) {
      void speakMessage({
        messageId: latestNewMessage.id,
        text: latestNewMessage.text,
        voiceId,
        silentOnMissingKey: true,
      });
    }
  }, [input.threadKey, input.feed, autoPlay, voiceId, isFocused]);
}
