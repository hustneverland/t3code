import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopPersonalBrand } from "./desktop-personal-brand.ts";

describe("resolveDesktopPersonalBrand", () => {
  it("is null for the stock build", () => {
    expect(resolveDesktopPersonalBrand({})).toBeNull();
    expect(resolveDesktopPersonalBrand({ T3CODE_DESKTOP_APP_NAME: "  " })).toBeNull();
  });

  it("keeps the product name and takes an ASCII executable name beside it", () => {
    expect(
      resolveDesktopPersonalBrand({
        T3CODE_DESKTOP_APP_NAME: "星野",
        T3CODE_DESKTOP_EXECUTABLE_NAME: "Xingye",
        T3CODE_DESKTOP_ICON_PRESET: "Xingye",
      }),
    ).toEqual({
      productName: "星野",
      executableName: "Xingye",
      icons: { windowsIconIco: "assets/personal/xingye-windows.ico", webAssetBrand: "xingye" },
    });
  });

  it("uses an ASCII product name as the executable name", () => {
    expect(resolveDesktopPersonalBrand({ T3CODE_DESKTOP_APP_NAME: "Nightfall" })).toEqual({
      productName: "Nightfall",
      executableName: "Nightfall",
      icons: null,
    });
  });

  it("refuses a product name that cannot name the executable", () => {
    expect(() => resolveDesktopPersonalBrand({ T3CODE_DESKTOP_APP_NAME: "星野" })).toThrow(
      "T3CODE_DESKTOP_EXECUTABLE_NAME",
    );
  });

  it("refuses an unknown icon preset", () => {
    expect(() =>
      resolveDesktopPersonalBrand({
        T3CODE_DESKTOP_APP_NAME: "Nightfall",
        T3CODE_DESKTOP_ICON_PRESET: "nope",
      }),
    ).toThrow("not a known icon preset");
  });
});
