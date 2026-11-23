import type { WebAssetBrand } from "./brand-assets.ts";

/**
 * A personal desktop build can ship under its own name and icon. The stock build sets none of
 * these, so it resolves to null and nothing changes.
 */
export interface DesktopPersonalBrand {
  /** Shown to the user: installer, shortcuts, window title. May be any script. */
  readonly productName: string;
  /**
   * The .exe base name, and the name on the macOS disk image. ASCII, because the `t3` launcher is
   * a batch file that names this path.
   */
  readonly executableName: string;
  readonly icons: DesktopPersonalBrandIcons | null;
}

export interface DesktopPersonalBrandIcons {
  readonly windowsIconIco: string;
  /** 1024 px, drawn on Apple's icon grid: an 824 px body with transparent margins. */
  readonly macIconPng: string;
  readonly webAssetBrand: WebAssetBrand;
}

const ICON_PRESETS: Readonly<Record<string, DesktopPersonalBrandIcons>> = {
  xingye: {
    windowsIconIco: "assets/personal/xingye-windows.ico",
    macIconPng: "assets/personal/xingye-macos-1024.png",
    webAssetBrand: "xingye",
  },
};

const ASCII_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/;

export function resolveDesktopPersonalBrand(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DesktopPersonalBrand | null {
  const productName = env.T3CODE_DESKTOP_APP_NAME?.trim();
  if (!productName) return null;

  const executableName = env.T3CODE_DESKTOP_EXECUTABLE_NAME?.trim() || productName;
  if (!ASCII_FILE_NAME.test(executableName)) {
    throw new Error(
      "T3CODE_DESKTOP_EXECUTABLE_NAME must be an ASCII file name when T3CODE_DESKTOP_APP_NAME is not.",
    );
  }

  const preset = env.T3CODE_DESKTOP_ICON_PRESET?.trim().toLowerCase();
  const icons = preset ? ICON_PRESETS[preset] : null;
  if (preset && !icons) {
    throw new Error(`T3CODE_DESKTOP_ICON_PRESET "${preset}" is not a known icon preset.`);
  }

  return { productName, executableName, icons: icons ?? null };
}
