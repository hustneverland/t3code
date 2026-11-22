import { T, useGT } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useDeadlinePassed } from "../../lib/clock";
import {
  type AppUpdateCheckState,
  isAppUpdateCheckAvailable,
  runAppUpdateCheck,
} from "../updates/app-updates";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

export function SettingsAboutRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();

  return (
    <SettingsScreen title={gt("About")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <AppSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

function AppSettingsSection() {
  const gt = useGT();
  const [checkState, setCheckState] = useState<{
    readonly state: AppUpdateCheckState;
    // "Up to date" is a confirmation that fades back to idle.
    readonly settledUntil: number | null;
  }>({ state: "idle", settledUntil: null });
  const confirmationExpired = useDeadlinePassed(checkState.settledUntil);
  const updateState =
    checkState.state === "current" && confirmationExpired ? "idle" : checkState.state;
  const updateInFlight = useRef(false);

  const version = Constants.expoConfig?.version ?? "0.0.0";
  const otaId = !Updates.isEmbeddedLaunch && Updates.updateId ? Updates.updateId.slice(0, 7) : null;
  const otaLabel = otaId ? `OTA · ${otaId}` : null;
  const versionLabel = `v${version}`;
  const updateCheckAvailable = isAppUpdateCheckAvailable();
  const busy =
    updateState === "checking" || updateState === "downloading" || updateState === "restarting";

  async function checkForUpdate() {
    // disabled updates next render; the ref blocks same-frame double taps.
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    // Failures arrive through onFailure; the settled result only matters for unlocking.
    await settlePromise(() =>
      runAppUpdateCheck({
        applyMode: "immediate",
        onFailure: (message) => Dialog.alert(gt("Update failed"), message),
        onStateChange: (state) =>
          setCheckState({
            state,
            settledUntil: state === "current" ? Date.now() + 3000 : null,
          }),
      }),
    );
    updateInFlight.current = false;
  }

  const statusLabel =
    updateState === "checking"
      ? gt("Checking…")
      : updateState === "downloading"
        ? gt("Downloading…")
        : updateState === "ready"
          ? gt("Update ready")
          : updateState === "restarting"
            ? gt("Restarting…")
            : updateState === "current"
              ? gt("Up to date")
              : null;

  return (
    <SettingsSection title={gt("App", { $context: "settings section about this mobile app" })}>
      <SettingsRow
        icon="internaldrive"
        label={gt("Client Storage")}
        target="SettingsClientStorage"
      />
      <SettingsRow icon="stethoscope" label={gt("Diagnostics")} target="SettingsDiagnostics" />
      <SettingsRow
        icon="doc.on.doc"
        label={gt("Open source licenses")}
        target="SettingsOpenSourceLicenses"
      />
      <SettingsRow icon="doc.text" label={gt("Legal")} fullScreenTarget="SettingsLegal" />
      <View className="flex-row items-center gap-4 p-4">
        <SymbolView
          name="info.circle"
          size={22}
          tintColorClassName="accent-icon"
          type="monochrome"
          weight="regular"
        />
        <Text className="flex-1 text-lg text-foreground">
          <T>Version</T>
        </Text>
        <View className="items-end">
          <Text className="text-lg text-foreground-muted">{versionLabel}</Text>
          {otaLabel ? <Text className="text-xs text-foreground-muted/70">{otaLabel}</Text> : null}
        </View>
      </View>
      {updateCheckAvailable ? (
        <Pressable
          accessibilityLabel={gt("Check for updates")}
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void checkForUpdate()}
          style={({ pressed }) => ({ opacity: pressed || busy ? 0.5 : 1 })}
        >
          <View className="flex-row items-center gap-4 border-t border-border/50 p-4">
            <SymbolView
              name="arrow.down.circle"
              size={22}
              tintColorClassName="accent-icon"
              type="monochrome"
              weight="regular"
            />
            <Text className="flex-1 text-lg text-foreground">{gt("Check for updates")}</Text>
            {statusLabel ? (
              <Text className="text-sm text-foreground-muted">{statusLabel}</Text>
            ) : null}
          </View>
        </Pressable>
      ) : null}
    </SettingsSection>
  );
}
