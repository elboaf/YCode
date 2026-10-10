import { getycodeCopy, type SupportedLocale, type UiLocale } from "@ycode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getycodeCopy(locale, detectedLocale).cli.help(version);
}
