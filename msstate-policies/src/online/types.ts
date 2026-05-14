/**
 * Online module — types, frozen allowlists, mandatory disclaimer.
 *
 * Corpus rule (CLAUDE.md): every value here comes from a live
 * online.msstate.edu page. No training-data fallback.
 */

export const ONLINE_ROOTS: readonly string[] = Object.freeze([
  "https://www.online.msstate.edu/academic-programs",
  "https://www.online.msstate.edu/admissions-process",
  "https://www.online.msstate.edu/staff",
  "https://www.online.msstate.edu/",
]);

/**
 * Frozen list of support-page slugs. The scraper builds URLs by joining the
 * base ONLINE_ROOTS[3] with one of these slugs; no other path tails are
 * allowed in the support-page fetcher.
 */
export const SUPPORT_PAGE_SLUGS: readonly string[] = Object.freeze([
  "state-authorization",
  "military-assistance",
  "orientation",
  "faq",
  "financial-matters",
]);

export const ONLINE_DISCLAIMER =
  "Contact info, application deadlines, tuition, and program details on online.msstate.edu can change between releases. Verify against the source URL before applying.";

export const MAX_QUERY_CHARS = 4096;

export type DegreeLevel =
  | "bachelor"
  | "master"
  | "specialist"
  | "doctoral"
  | "certificate"
  | "endorsement";

export type StudentType =
  | "undergraduate"
  | "graduate"
  | "transfer"
  | "readmit"
  | "international";

export type OnlineParseWarning =
  | "no_contacts_extracted"
  | "no_deadlines_extracted"
  | "tuition_unparsed"
  | "admissions_section_missing"
  | "format_field_missing";

export interface OnlineContact {
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
}

export interface OnlineApplicationDeadline {
  term: string;       // "Fall" | "Spring" | "Summer" — verbatim
  date_text: string;  // "August 1" — verbatim, NOT parsed to ISO
}

export interface OnlineEntranceExams {
  required: string[];
  not_required: string[];
  notes: string;
}

export interface OnlineProgramTuition {
  per_credit_usd: number | null;
  instructional_fee_per_credit_usd: number | null;
  application_fee_domestic_usd: number | null;
  application_fee_international_usd: number | null;
  raw_prose: string;
}

export interface OnlineProgram {
  slug: string;
  name: string;
  degree_level: DegreeLevel;
  format: string;
  short_description: string;
  url: string;
  tuition: OnlineProgramTuition;
  contacts: OnlineContact[];
  application_deadlines: OnlineApplicationDeadline[];
  admission_requirements: string;
  entrance_exams: OnlineEntranceExams | null;
  accreditation: string | null;
  forms: { label: string; url: string }[];
  raw_sections: Record<string, string>;
  parse_warnings: OnlineParseWarning[];
  retrieved_at: string;
}

export interface OnlineAdmissionsProcess {
  url: string;
  central_contact: OnlineContact;
  shared_prelude: string;
  sections: Record<StudentType, string>;
  application_fee_tiers: { kind: string; usd: number }[];
  external_apply_urls: { kind: string; url: string }[];
  retrieved_at: string;
}

export interface OnlineStaffEntry {
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  office: string;
  url: string;
  retrieved_at: string;
}

export interface OnlineInfoPage {
  slug: string;
  title: string;
  url: string;
  body_markdown: string;
  retrieved_at: string;
}

export interface OnlineCorpus {
  builtAt: string;
  source: "https://www.online.msstate.edu/";
  programs: OnlineProgram[];
  admissions_process: OnlineAdmissionsProcess;
  staff: OnlineStaffEntry[];
  info_pages: OnlineInfoPage[];
}

export class OnlineWafError extends Error {
  constructor(public readonly url: string) {
    super(`WAF challenge detected at ${url}`);
    this.name = "OnlineWafError";
  }
}
