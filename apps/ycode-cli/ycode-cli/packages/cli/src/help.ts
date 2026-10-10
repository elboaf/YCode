import { getZCodeCopy, type SupportedLocale, type UiLocale } from "@ycode/i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getZCodeCopy(locale, detectedLocale).cli.help(version);
}
