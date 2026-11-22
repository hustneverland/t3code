import Constants from "expo-constants";

import { DEFAULT_MOBILE_THEME_ID, type MobileThemeId } from "../lib/mobileTheme";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const APP_DISPLAY_NAME = Constants.expoConfig?.name?.trim() || "T3 Code";
export const IS_XINGYE_BRAND = APP_DISPLAY_NAME === "星野";
/** The look a fresh install starts with; a theme the user picked always wins. */
export const BRAND_DEFAULT_THEME_ID: MobileThemeId = IS_XINGYE_BRAND
  ? "xingye"
  : DEFAULT_MOBILE_THEME_ID;

export const T3_CODE_BRAND_MARK_SOURCE = IS_XINGYE_BRAND
  ? require("../../assets/personal-icon-xingye.png")
  : appVariant === "development"
    ? require("../../../../assets/dev/blueprint-ios-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/nightly/nightly-ios-1024.png")
      : require("../../../../assets/prod/black-ios-1024.png");
