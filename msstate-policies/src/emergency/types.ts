/**
 * Emergency module — types, frozen allowlist, alias map, disclaimer constant.
 *
 * Corpus rule (CLAUDE.md): every value here either comes from the live MSU
 * emergency site (slugs, contact phone numbers when seeded by the scraper) or
 * is a curated alias derived from the 12 page titles + h1s on those pages.
 * No training-data fallback.
 */

export const EMERGENCY_ROOTS: readonly string[] = Object.freeze([
  "https://www.emergency.msstate.edu/guidelines/",
  "https://www.emergency.msstate.edu/refuge",
]);

export const EXPECTED_GUIDELINE_SLUGS: readonly string[] = Object.freeze([
  "building-evacuations",
  "campus-evacuations",
  "earthquake",
  "infectious-disease",
  "op-guidance",
  "preparedness",
  "severe-weather-tornado",
  "sheltering-in-place",
  "smoke-fire",
  "suspicious-devices-substances",
  "violence-threats-of-violence",
  "winter-weather",
]);

export const EMERGENCY_ALIASES: Record<string, string> = {
  "tornado":             "severe-weather-tornado",
  "severe weather":      "severe-weather-tornado",
  "thunderstorm":        "severe-weather-tornado",
  "shooter":             "violence-threats-of-violence",
  "active shooter":      "violence-threats-of-violence",
  "violence":            "violence-threats-of-violence",
  "fire":                "smoke-fire",
  "smoke":               "smoke-fire",
  "evacuate":            "building-evacuations",
  "evacuation":          "building-evacuations",
  "shelter":             "sheltering-in-place",
  "shelter in place":    "sheltering-in-place",
  "lockdown":            "sheltering-in-place",
  "earthquake":          "earthquake",
  "covid":               "infectious-disease",
  "pandemic":            "infectious-disease",
  "flu":                 "infectious-disease",
  "ice storm":           "winter-weather",
  "snow":                "winter-weather",
  "winter":              "winter-weather",
  "bomb":                "suspicious-devices-substances",
  "suspicious package":  "suspicious-devices-substances",
  "prepare":             "preparedness",
  "preparation":         "preparedness",
};

export const MANDATORY_DISCLAIMER =
  "If this is a life-threatening emergency, call 911 now (or MSU PD at 662-325-2121).";

export const MAX_QUERY_CHARS = 4096;

export interface GuidelineRow {
  slug: string;
  title: string;
  url: string;
  body_markdown: string;
  aliases: string[];
  retrieved_at: string;
}

export interface RefugeRow {
  building: string;
  area: string;
  note: string | null;
  source_url: string;
  retrieved_at: string;
}

export type ContactCategory =
  | "emergency"
  | "campus_non_emergency"
  | "off_campus_non_emergency";

export interface ContactRow {
  label: string;
  phone: string;
  category: ContactCategory;
  source_url: string;
  retrieved_at: string;
}

export interface EmergencyCorpus {
  builtAt: string;
  source: "https://www.emergency.msstate.edu/";
  guidelines: GuidelineRow[];
  refuge_areas: RefugeRow[];
  contacts: ContactRow[];
}

export class EmergencyWafError extends Error {
  constructor(public readonly url: string) {
    super(`WAF challenge detected at ${url}`);
    this.name = "EmergencyWafError";
  }
}
