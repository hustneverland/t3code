import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const APP_DISPLAY_NAME = Constants.expoConfig?.name?.trim() || "T3 Code";
export const IS_XINGYE_BRAND = APP_DISPLAY_NAME === "星野";

export const T3_CODE_BRAND_MARK_SOURCE = IS_XINGYE_BRAND
  ? require("../../assets/personal-icon-xingye.png")
  : appVariant === "development"
    ? require("../../../../assets/dev/blueprint-ios-1024.png")
    : appVariant === "preview"
      ? require("../../../../assets/nightly/nightly-ios-1024.png")
      : require("../../../../assets/prod/black-ios-1024.png");
