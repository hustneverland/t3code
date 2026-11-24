import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/reactivity";
import { useGT, useMessages } from "gt-react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import { openSettings } from "../settings/settings-navigation";
import { DEFAULT_TTS_VOICE_ID, resolveTtsVoice, TTS_VOICES } from "../voice-playback/ttsVoices";
import { stopSpeaking, useVoicePlaybackSnapshot } from "../voice-playback/voicePlaybackStore";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";

const VOICE_MENU_COPY = {
  // oxlint-disable-next-line t3code/no-untranslated-copy -- Personal Xingye TTS menu labels
  title: "语音播报",
  stop: "停止播报",
  autoPlay: "自动播报",
  settings: "语音播报设置…",
  moreTools: "更多工具",
  openFiles: "文件",
  closeFiles: "关闭文件",
} as const;

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const navigation = useNavigation();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes } = useWorkspacePaneState();
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;

  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const playback = useVoicePlaybackSnapshot();
  const autoPlay = AsyncResult.isSuccess(preferencesResult)
    ? preferencesResult.value.ttsAutoPlay === true
    : false;
  const selectedVoice = resolveTtsVoice(
    AsyncResult.isSuccess(preferencesResult)
      ? (preferencesResult.value.ttsVoiceId ?? DEFAULT_TTS_VOICE_ID)
      : DEFAULT_TTS_VOICE_ID,
  );
  const isSpeaking = playback.status !== "idle";

  const actions: AppBarAction[] = isSpeaking
    ? [
        {
          accessibilityLabel: VOICE_MENU_COPY.stop,
          icon: "stop.fill",
          selected: true,
          separateBackground: false,
          onPress: stopSpeaking,
        },
      ]
    : [];

  const voiceMenuItems: AppBarMenuItem[] = [
    ...(isSpeaking
      ? [
          {
            id: "tts-stop",
            title: VOICE_MENU_COPY.stop,
            icon: "stop.fill",
            onPress: stopSpeaking,
          },
        ]
      : []),
    {
      id: "tts-autoplay",
      title: VOICE_MENU_COPY.autoPlay,
      subtitle: selectedVoice.label,
      icon: autoPlay ? "waveform" : "speaker.slash",
      selected: autoPlay,
      onPress: () => {
        const next = !autoPlay;
        if (!next) stopSpeaking();
        void savePreferences({ ttsAutoPlay: next });
      },
    },
    {
      id: "tts-voices",
      inline: true,
      items: TTS_VOICES.map((voice) => ({
        id: `tts-voice:${voice.id}`,
        title: voice.label,
        subtitle: voice.subtitle,
        selected: voice.id === selectedVoice.id,
        onPress: () => {
          void savePreferences({ ttsVoiceId: voice.id });
        },
      })),
    },
    {
      id: "tts-settings",
      title: VOICE_MENU_COPY.settings,
      icon: "gearshape",
      onPress: () => openSettings(navigation, "SettingsVoice"),
    },
  ];

  const voiceMenu: AppBarMenu = {
    title: VOICE_MENU_COPY.title,
    icon: autoPlay ? "waveform" : "headphones",
    separateBackground: false,
    items: voiceMenuItems,
  };

  const overflowToolItems: AppBarMenuItem[] = [];
  if (props.hasThreadCwd) {
    overflowToolItems.push({
      id: "tools-files",
      title: filesVisible ? VOICE_MENU_COPY.closeFiles : VOICE_MENU_COPY.openFiles,
      icon: "folder",
      selected: filesVisible,
      disabled: !props.gitControls.canOpenFiles,
      onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
    });
  }
  if (gitMenu) {
    overflowToolItems.push({
      id: "tools-git",
      title: gitMenu.title,
      icon: "arrow.triangle.branch",
      items: gitMenu.items,
    });
  }
  if (terminalMenu) {
    overflowToolItems.push({
      id: "tools-terminal",
      title: terminalMenu.title,
      icon: "terminal",
      items: terminalMenu.items,
    });
  }

  const menus: AppBarMenu[] = [
    voiceMenu,
    ...(overflowToolItems.length > 0
      ? [
          {
            title: VOICE_MENU_COPY.moreTools,
            icon: "ellipsis" as const,
            separateBackground: false,
            items: overflowToolItems,
          },
        ]
      : []),
  ];

  return (
    <AppBar
      title={props.title}
      subtitle={props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
