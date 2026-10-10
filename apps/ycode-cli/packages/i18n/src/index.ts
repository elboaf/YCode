import type { UiLocale, SupportedLocale } from "@ycode/contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { ycodeCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, ycodeCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, ycodeCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getycodeCopy(locale?: UiLocale | string, detected?: string | null): ycodeCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
