/* oxlint-disable t3code/no-untranslated-copy -- Personal Xingye Doubao TTS voice catalog */
export interface TtsVoiceOption {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly resourceId: "seed-tts-2.0" | "seed-tts-1.0";
  readonly speaker: string;
}

export const DEFAULT_TTS_VOICE_ID = "xiaohe-2.0";

export const TTS_VOICES: readonly TtsVoiceOption[] = [
  {
    id: "xiaohe-2.0",
    label: "小何 2.0",
    subtitle: "台湾温柔女声 · 豆包 2.0",
    resourceId: "seed-tts-2.0",
    speaker: "zh_female_xiaohe_uranus_bigtts",
  },
  {
    id: "wanwan-xiaohe",
    label: "湾湾小何",
    subtitle: "经典正宗台妹 · 1.0",
    resourceId: "seed-tts-1.0",
    speaker: "zh_female_wanwanxiaohe_moon_bigtts",
  },
  {
    id: "vivi-2.0",
    label: "vivi 2.0",
    subtitle: "豆包招牌自然女声 · 2.0",
    resourceId: "seed-tts-2.0",
    speaker: "zh_female_vv_uranus_bigtts",
  },
  {
    id: "tianmei-taozi",
    label: "甜美桃子 2.0",
    subtitle: "清甜软萌女声 · 2.0",
    resourceId: "seed-tts-2.0",
    speaker: "zh_female_tianmeitaozi_uranus_bigtts",
  },
  {
    id: "sajiao-xuemei",
    label: "撒娇学妹 2.0",
    subtitle: "活泼娇俏女声 · 2.0",
    resourceId: "seed-tts-2.0",
    speaker: "zh_female_sajiaoxuemei_uranus_bigtts",
  },
] as const;

export function resolveTtsVoice(voiceId: string | undefined): TtsVoiceOption {
  return TTS_VOICES.find((voice) => voice.id === voiceId) ?? TTS_VOICES[0]!;
}
