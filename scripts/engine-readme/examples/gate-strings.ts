import { localeDirection, resolveLocale, stringTable } from "@jams/engine/game";
import type { LocaleSettings } from "@jams/engine/project";

import { gateProject } from "./gate-game";

/** The guard's lines in three locales, and which locale three players start in. */
export function gateInThreeLocales() {
  const en = stringTable(gateProject, "en");
  const fr = stringTable(gateProject, "fr");
  const ar = stringTable(gateProject, "ar");
  const locales = gateProject.engine.locales as LocaleSettings;
  return {
    en: en.get("gate.halt", { toll: 3 }),
    fr: fr.get("gate.halt", { toll: 3 }),
    // Arabic has only the guard's name; every other key falls back to English.
    ar: [ar.get("speaker.guard"), ar.get("gate.pay"), ar.direction],
    missing: fr.get("gate.closed"),
    hasMissing: fr.has("gate.closed"),
    // A saved choice wins, then the browser's languages by language subtag, then the default.
    saved: resolveLocale(locales, { saved: "fr", languages: ["ar-EG"] }),
    browser: resolveLocale(locales, { languages: ["fr-CA", "en-GB"] }),
    neither: resolveLocale(locales, { languages: ["de-DE"] }),
    hebrew: localeDirection("he-IL"),
  };
}
