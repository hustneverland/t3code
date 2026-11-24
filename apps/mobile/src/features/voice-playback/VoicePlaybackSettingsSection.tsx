/* oxlint-disable t3code/no-untranslated-copy -- Personal Xingye Doubao TTS settings UI */
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import * as Dialog from "../../components/ui/Dialog";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { DEFAULT_TTS_VOICE_ID, resolveTtsVoice, TTS_VOICES } from "./ttsVoices";
import {
  loadVolcengineTtsApiKey,
  saveVolcengineTtsApiKey,
  speakVoicePreview,
  stopSpeaking,
  useVoicePlaybackSnapshot,
} from "./voicePlaybackStore";

const COPY = {
  sectionTitle: "语音播报（豆包语音）",
  autoPlayLabel: "默认自动播报",
  autoPlaySubtitle: "AI 回复完成后自动念出人话内容，跳过代码块",
  voiceSectionTitle: "播报音色",
  previewPlay: "试听当前音色",
  previewLoading: "正在合成试听…",
  previewStop: "停止试听",
  apiKeyLabel: "火山引擎 API Key",
  apiKeyConfigured: "已加密保存在本机（直连火山引擎，不经代理）",
  apiKeyMissing: "填入后即可直连豆包语音播报",
  apiKeyPlaceholder: "粘贴火山引擎 x-api-key",
  saveButton: "保存",
  clearButton: "清除",
  savedTitle: "已保存",
  savedBody: "API Key 已加密保存在本机，随时可以开播或试听。",
  clearedTitle: "已清除",
  clearedBody: "已删除本机保存的 API Key。",
  missingKeyAlertTitle: "请先保存 API Key",
  missingKeyAlertBody: "在下方填入并保存火山引擎 API Key 后即可试听音色。",
} as const;

export function VoicePlaybackSettingsSection() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const playback = useVoicePlaybackSnapshot();

  const autoPlay = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.ttsAutoPlay === true
    : false;
  const selectedVoiceId = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.ttsVoiceId ?? DEFAULT_TTS_VOICE_ID)
    : DEFAULT_TTS_VOICE_ID;
  const currentVoice = resolveTtsVoice(selectedVoiceId);

  const [keyDraft, setKeyDraft] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads SecureStore configuration status once when settings open
  useEffect(() => {
    void loadVolcengineTtsApiKey();
  }, []);

  const previewing = playback.messageId?.startsWith("preview:") && playback.status !== "idle";
  const previewLoading =
    playback.messageId?.startsWith("preview:") && playback.status === "loading";
  const previewLabel = previewLoading
    ? COPY.previewLoading
    : previewing
      ? COPY.previewStop
      : `${COPY.previewPlay} · ${currentVoice.label}`;

  const handleSaveKey = async () => {
    if (savingKey) return;
    const trimmed = keyDraft.trim();
    if (!trimmed) return;
    setSavingKey(true);
    try {
      await saveVolcengineTtsApiKey(trimmed);
      setKeyDraft("");
      Dialog.alert(COPY.savedTitle, COPY.savedBody);
    } finally {
      setSavingKey(false);
    }
  };

  const handleClearKey = async () => {
    if (savingKey) return;
    setSavingKey(true);
    try {
      stopSpeaking();
      await saveVolcengineTtsApiKey("");
      setKeyDraft("");
      Dialog.alert(COPY.clearedTitle, COPY.clearedBody);
    } finally {
      setSavingKey(false);
    }
  };

  const handlePreview = async () => {
    if (previewing) {
      stopSpeaking();
      return;
    }
    const key = await loadVolcengineTtsApiKey();
    if (!key) {
      Dialog.alert(COPY.missingKeyAlertTitle, COPY.missingKeyAlertBody);
      return;
    }
    void speakVoicePreview(currentVoice.id);
  };

  return (
    <>
      <SettingsSection title={COPY.sectionTitle}>
        <SettingsSwitchRow
          icon="waveform"
          label={COPY.autoPlayLabel}
          subtitle={COPY.autoPlaySubtitle}
          value={autoPlay}
          onValueChange={(next) => {
            if (!next) stopSpeaking();
            void savePreferences({ ttsAutoPlay: next });
          }}
        />
        <View className="border-t border-border-subtle px-4 py-3.5 gap-2.5">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-sm font-t3-medium text-foreground">{COPY.apiKeyLabel}</Text>
            <Text
              className={
                playback.apiKeyConfigured
                  ? "text-xs font-t3-medium text-primary"
                  : "text-xs text-foreground-muted"
              }
            >
              {playback.apiKeyConfigured ? "已配置" : "未配置"}
            </Text>
          </View>
          <Text className="text-xs text-foreground-muted">
            {playback.apiKeyConfigured ? COPY.apiKeyConfigured : COPY.apiKeyMissing}
          </Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={keyDraft}
              onChangeText={setKeyDraft}
              placeholder={COPY.apiKeyPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 rounded-xl border border-border bg-screen px-3 py-2 text-sm text-foreground"
            />
            <Pressable
              accessibilityRole="button"
              disabled={savingKey || keyDraft.trim().length === 0}
              onPress={() => void handleSaveKey()}
              className="rounded-xl bg-primary px-3.5 py-2 active:opacity-70"
              style={{ opacity: savingKey || keyDraft.trim().length === 0 ? 0.45 : 1 }}
            >
              <Text className="text-sm font-t3-medium text-primary-foreground">
                {COPY.saveButton}
              </Text>
            </Pressable>
            {playback.apiKeyConfigured ? (
              <Pressable
                accessibilityRole="button"
                disabled={savingKey}
                onPress={() => void handleClearKey()}
                className="rounded-xl border border-border px-3 py-2 active:opacity-70"
              >
                <Text className="text-sm font-t3-medium text-foreground-muted">
                  {COPY.clearButton}
                </Text>
              </Pressable>
            ) : null}
          </View>
          {playback.error ? (
            <Text className="text-xs text-destructive">{playback.error}</Text>
          ) : null}
        </View>
      </SettingsSection>

      <SettingsSection title={COPY.voiceSectionTitle}>
        {TTS_VOICES.map((voice, index) => (
          <ListChoiceRow
            key={voice.id}
            label={voice.label}
            description={voice.subtitle}
            selected={voice.id === currentVoice.id}
            separated={index > 0}
            onPress={() => {
              void savePreferences({ ttsVoiceId: voice.id });
            }}
          />
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => void handlePreview()}
          className="flex-row items-center justify-center gap-2 border-t border-border-subtle px-4 py-3.5 active:opacity-60"
        >
          <SymbolView
            name={previewing ? "stop.fill" : "waveform"}
            size={16}
            tintColorClassName="accent-primary"
            type="monochrome"
          />
          <Text className="text-sm font-t3-medium text-primary">{previewLabel}</Text>
        </Pressable>
      </SettingsSection>
    </>
  );
}
