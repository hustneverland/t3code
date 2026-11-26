import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useComposerDraft } from "../../state/use-composer-drafts";
import { usePromptSuggestion } from "./usePromptSuggestion";

export function ComposerPromptSuggestionBar(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly latestRun: EnvironmentThreadShell["latestRun"];
  readonly draftKey: string | null;
  readonly enabled: boolean;
  readonly contentMaxWidth: number | undefined;
  readonly onFillSuggestion: (text: string) => void;
  readonly onSendSuggestion: (text: string) => void;
}) {
  const gt = useGT();
  const draft = useComposerDraft(props.draftKey);
  const hasDraftContent = draft.text.trim().length > 0;
  const { suggestion, dismiss } = usePromptSuggestion({
    environmentId: props.environmentId,
    threadRef: props.threadRef,
    latestRun: props.latestRun,
    enabled: props.enabled && !hasDraftContent,
  });

  if (!props.enabled || hasDraftContent || suggestion === null) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeInDown.duration(160)}
      exiting={FadeOut.duration(120)}
      className="self-center px-3 pb-1.5"
      style={{ width: "100%", maxWidth: props.contentMaxWidth }}
    >
      <View className="flex-row items-center gap-2 rounded-2xl border border-border-subtle bg-grouped-card px-3 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Use suggested prompt")}
          onPress={() => {
            void Haptics.selectionAsync();
            props.onFillSuggestion(suggestion);
          }}
          className="min-w-0 flex-1 flex-row items-center gap-2 active:opacity-75"
        >
          <SymbolView
            name="bubble.left"
            size={14}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
          <Text numberOfLines={2} className="min-w-0 flex-1 text-sm leading-[19px] text-foreground">
            {suggestion}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Send suggested prompt")}
          hitSlop={6}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            props.onSendSuggestion(suggestion);
          }}
          className="h-7 w-7 items-center justify-center rounded-full bg-accent active:opacity-80"
        >
          <SymbolView
            name="arrow.up"
            size={14}
            tintColorClassName="accent-accent-foreground"
            type="monochrome"
            weight="semibold"
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Dismiss suggested prompt")}
          hitSlop={6}
          onPress={() => {
            void Haptics.selectionAsync();
            dismiss();
          }}
          className="h-7 w-7 items-center justify-center rounded-full active:opacity-70"
        >
          <SymbolView
            name="xmark"
            size={13}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
        </Pressable>
      </View>
    </Animated.View>
  );
}
