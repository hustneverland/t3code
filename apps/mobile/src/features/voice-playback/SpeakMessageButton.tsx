import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { memo } from "react";
import { Pressable, type ColorValue } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import * as Dialog from "../../components/ui/Dialog";
import { mobilePreferencesAtom } from "../../state/preferences";
import { openSettings } from "../settings/settings-navigation";
import { DEFAULT_TTS_VOICE_ID } from "./ttsVoices";
import {
  loadVolcengineTtsApiKey,
  speakMessage,
  stopSpeaking,
  useVoicePlaybackSnapshot,
} from "./voicePlaybackStore";

const SPEAK_LABEL = "朗读回复";
const STOP_LABEL = "停止朗读";
const MISSING_KEY_TITLE = "未配置豆包语音 Key";
const MISSING_KEY_BODY = "请先在「设置 → 语音」中填写火山引擎 API Key，保存后即可直接播报。";
const OPEN_SETTINGS_LABEL = "去设置";
const CANCEL_LABEL = "取消";

export const SpeakMessageButton = memo(function SpeakMessageButton(props: {
  readonly messageId: string;
  readonly text: string;
  readonly tintColor?: ColorValue;
  readonly iconSize?: number;
  readonly buttonSize?: number;
}) {
  const navigation = useNavigation();
  const playback = useVoicePlaybackSnapshot();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const voiceId = AsyncResult.isSuccess(preferences)
    ? (preferences.value.ttsVoiceId ?? DEFAULT_TTS_VOICE_ID)
    : DEFAULT_TTS_VOICE_ID;

  const isThisMessage = playback.messageId === props.messageId;
  const isActive = isThisMessage && playback.status !== "idle";
  const isLoading = isThisMessage && playback.status === "loading";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isActive ? STOP_LABEL : SPEAK_LABEL}
      disabled={props.text.trim().length === 0}
      hitSlop={8}
      onPress={async () => {
        if (isActive) {
          stopSpeaking();
          return;
        }
        const key = await loadVolcengineTtsApiKey();
        if (!key) {
          Dialog.alert(MISSING_KEY_TITLE, MISSING_KEY_BODY, [
            { text: CANCEL_LABEL, style: "cancel" },
            {
              text: OPEN_SETTINGS_LABEL,
              onPress: () => openSettings(navigation, "SettingsVoice"),
            },
          ]);
          return;
        }
        void speakMessage({
          messageId: props.messageId,
          text: props.text,
          voiceId,
        });
      }}
      style={({ pressed }) => ({
        width: props.buttonSize ?? 30,
        height: props.buttonSize ?? 30,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        opacity: pressed || isLoading ? 0.5 : 1,
      })}
    >
      <SymbolView
        name={isActive ? "stop.circle" : "waveform"}
        size={props.iconSize ?? 14}
        tintColor={isActive ? undefined : props.tintColor}
        tintColorClassName={
          isActive ? "accent-primary" : props.tintColor ? undefined : "accent-foreground"
        }
        type="monochrome"
      />
    </Pressable>
  );
});
