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

/**
 * Caller-supplied profile for match_online_program. Every field is optional;
 * the matcher degrades gracefully when fields are absent (no field = no
 * constraint on that axis). NEVER infer fields from training data — only
 * use what the user provided.
 */
export interface MatcherProfile {
  career_goal?: string;          // free-text, tokenized + matched against program name + short_description
  level_preference?: DegreeLevel; // hard filter when present
  budget_usd?: number;            // hard cap on estimated total-cost when credits + per_credit are known
  time_budget_months?: number;    // soft signal (no per-program duration in corpus; lowers score for doctoral when small)
  state?: string;                 // 2-letter postal code; cross-referenced with state-authorization info page
  estimated_credits?: number;     // optional override; defaults to 30 (master/cert), 120 (bachelor) when null
  include_application_fee?: boolean; // default false; flipping to true adds the per-program application fee to the estimate
}

export interface CostEstimate {
  slug: string;
  name: string;
  credits_used: number;
  // credits_source: distinguishes user-supplied from the per-level default. Specialist
  // and endorsement programs are intentionally aliased to default_master_30 — these
  // typically run ~30 credit hours and MSU Online does not separately publish their
  // standard length. estimateCost in matcher.ts treats them as 30-credit master-like.
  credits_source: "user_supplied" | "default_master_30" | "default_bachelor_120" | "default_doctoral_60" | "default_certificate_30";
  per_credit_usd: number | null;
  instructional_fee_per_credit_usd: number | null;
  application_fee_usd: number | null;
  application_fee_included: boolean;
  tuition_total_usd: number | null;
  instructional_fee_total_usd: number | null;
  total_usd: number | null;
  notes: string[];                // e.g., "per_credit_usd missing — total cannot be computed"
  source_url: string;
  raw_prose: string;
}

export interface MatchedProgram {
  slug: string;
  name: string;
  degree_level: DegreeLevel;
  fit_score: number;              // 0–100, deterministic from scoreMatch
  fit_reasons: string[];          // e.g., ["matches career_goal: 'data'", "within budget: ~$22,500 < $25,000"]
  application_deadline_next: OnlineApplicationDeadline | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  estimated_total_usd: number | null;
  estimated_total_credits: number | null;
  state_authorization_flag: "ok" | "unknown" | "check_state_authorization_page";
  url: string;
}

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
  staff_to_programs: StaffToProgramsIndex;
}

/**
 * Reference to a program from a staff member's perspective.
 * `role_in_program` is the contact-card role label from the program page
 * (e.g., "General Program Questions, Admissions Process & Requirements").
 */
export interface ProgramRef {
  slug: string;
  name: string;
  role_in_program: string;
}

/**
 * One staff member with their full program portfolio.
 * `display_name` is the canonical form (longest spelling wins on dedup).
 * `role` is the department title from the staff directory when known.
 */
export interface StaffEntry {
  display_name: string;
  email: string | null;
  role: string;
  programs: ProgramRef[];
}

/**
 * Flat array of staff with their programs. Built at scrape time from
 * OnlineProgram.contacts[]. Used by list_programs_by_staff.
 */
export type StaffToProgramsIndex = StaffEntry[];

export class OnlineWafError extends Error {
  constructor(public readonly url: string) {
    super(`WAF challenge detected at ${url}`);
    this.name = "OnlineWafError";
  }
}
