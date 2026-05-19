/**
 * Pure scoring + cost-estimation helpers over the OnlineCorpus.
 * No I/O, no MCP types. Imported by both the stdio tool wrappers and the
 * Worker mirror.
 *
 * Corpus rule (CLAUDE.md): never substitute training data for a missing
 * field. When a required input is null, emit a note and return null totals.
 */
import type {
  OnlineProgram,
  CostEstimate,
  DegreeLevel,
  MatcherProfile,
  MatchedProgram,
} from "./types.js";

function defaultCreditsFor(level: DegreeLevel): { credits: number; source: CostEstimate["credits_source"] } {
  switch (level) {
    case "bachelor":     return { credits: 120, source: "default_bachelor_120" };
    case "doctoral":     return { credits: 60,  source: "default_doctoral_60" };
    case "certificate":  return { credits: 30,  source: "default_certificate_30" };
    // master + specialist + endorsement fall through to the master default
    // (see comment on CostEstimate.credits_source in types.ts for why).
    default:             return { credits: 30,  source: "default_master_30" };
  }
}

export function estimateCost(
  program: OnlineProgram,
  credits: number | null,
  includeApplicationFee: boolean,
): CostEstimate {
  if (credits !== null && credits < 0) {
    throw new Error("credits must be >= 0");
  }
  const notes: string[] = [];
  const used = credits === null
    ? defaultCreditsFor(program.degree_level)
    : { credits, source: "user_supplied" as const };

  const perCredit = program.tuition.per_credit_usd;
  const instructional = program.tuition.instructional_fee_per_credit_usd;
  const applicationFee = program.tuition.application_fee_domestic_usd;

  const tuitionTotal = perCredit !== null ? perCredit * used.credits : null;
  const instructionalTotal = instructional !== null ? instructional * used.credits : null;

  if (perCredit === null) notes.push("per_credit_usd missing on this program's page — total cannot be computed");
  if (instructional === null) notes.push("instructional_fee_per_credit_usd missing — component omitted from total");
  if (credits === null) notes.push(`credits not supplied; defaulted to ${used.credits} for ${program.degree_level} programs`);

  let total: number | null = null;
  if (tuitionTotal !== null) {
    total = tuitionTotal + (instructionalTotal ?? 0);
    if (includeApplicationFee && applicationFee !== null) total += applicationFee;
  }

  return {
    slug: program.slug,
    name: program.name,
    credits_used: used.credits,
    credits_source: used.source,
    per_credit_usd: perCredit,
    instructional_fee_per_credit_usd: instructional,
    application_fee_usd: applicationFee,
    application_fee_included: includeApplicationFee && applicationFee !== null,
    tuition_total_usd: tuitionTotal,
    instructional_fee_total_usd: instructionalTotal,
    total_usd: total,
    notes,
    source_url: program.url,
    raw_prose: program.tuition.raw_prose,
  };
}

const TOKEN_SPLIT = /[\s\-_/.,;:()\[\]{}!?"'`<>|@#$%^&*=+]+/;

function tokenize(s: string): string[] {
  return s.normalize("NFKC").toLowerCase().split(TOKEN_SPLIT).filter((t) => t.length > 0);
}

export interface StateAuthorization {
  authorized_states: string[]; // 2-letter postal codes from the state-authorization info page
}

const MAX_MATCHES = 5;

export function rankPrograms(
  programs: OnlineProgram[],
  profile: MatcherProfile,
  stateAuth: StateAuthorization | null,
): MatchedProgram[] {
  // Hard filter: level
  let candidates = profile.level_preference
    ? programs.filter((p) => p.degree_level === profile.level_preference)
    : programs;

  const goalTokens = profile.career_goal ? new Set(tokenize(profile.career_goal)) : null;
  const includeAppFee = profile.include_application_fee ?? false;

  const scored = candidates.map((p) => {
    const reasons: string[] = [];
    let score = 0;

    if (goalTokens && goalTokens.size > 0) {
      const haystack = new Set([...tokenize(p.name), ...tokenize(p.short_description)]);
      let hits = 0;
      for (const t of goalTokens) if (haystack.has(t)) hits++;
      const goalScore = Math.min(60, (hits / goalTokens.size) * 60);
      score += goalScore;
      if (hits > 0) reasons.push(`matches career_goal tokens (${hits}/${goalTokens.size})`);
    } else {
      score += 30; // neutral score when no career_goal supplied
    }

    // Cost score (-30 to +30): under budget = +30, over budget = penalty scaled by overshoot ratio.
    // A program that costs >140% of budget gets a net penalty (score < 0 for this component).
    const cost = estimateCost(p, profile.estimated_credits ?? null, includeAppFee);
    if (profile.budget_usd !== undefined && cost.total_usd !== null) {
      if (cost.total_usd <= profile.budget_usd) {
        score += 30;
        reasons.push(`within budget: $${cost.total_usd.toLocaleString()} <= $${profile.budget_usd.toLocaleString()}`);
      } else {
        const overshoot = (cost.total_usd - profile.budget_usd) / profile.budget_usd;
        // overshoot=0 → +30, overshoot=1 → -30, overshoot=2 → -90 (clamped to -30)
        const costComponent = Math.max(-30, 30 - overshoot * 60);
        score += costComponent;
        reasons.push(`over budget: $${cost.total_usd.toLocaleString()} > $${profile.budget_usd.toLocaleString()}`);
      }
    } else {
      score += 15; // neutral when no budget supplied or cost not computable
    }

    // Time score (0-10): doctoral penalised when time_budget_months small
    if (profile.time_budget_months !== undefined) {
      if (p.degree_level === "doctoral" && profile.time_budget_months < 36) score -= 10;
      else if (p.degree_level === "bachelor" && profile.time_budget_months < 24) score -= 5;
      else { score += 10; reasons.push(`level fits time budget (${profile.time_budget_months}mo)`); }
    } else {
      score += 5;
    }

    let stateFlag: MatchedProgram["state_authorization_flag"] = "unknown";
    if (profile.state) {
      if (!stateAuth) {
        stateFlag = "unknown";
      } else if (stateAuth.authorized_states.includes(profile.state.toUpperCase())) {
        stateFlag = "ok";
        reasons.push(`state ${profile.state.toUpperCase()} in authorized list`);
      } else {
        stateFlag = "check_state_authorization_page";
        reasons.push(`state ${profile.state.toUpperCase()} not in authorized list — confirm via state-authorization page`);
      }
    }

    const primary = p.contacts[0] ?? null;
    const nextDeadline = p.application_deadlines[0] ?? null;

    const matched: MatchedProgram = {
      slug: p.slug,
      name: p.name,
      degree_level: p.degree_level,
      fit_score: Math.max(0, Math.min(100, Math.round(score))),
      fit_reasons: reasons,
      application_deadline_next: nextDeadline,
      primary_contact_name: primary?.name ?? null,
      primary_contact_email: primary?.email ?? null,
      estimated_total_usd: cost.total_usd,
      estimated_total_credits: cost.credits_used,
      state_authorization_flag: stateFlag,
      url: p.url,
    };
    return matched;
  });

  scored.sort((a, b) => b.fit_score - a.fit_score);
  return scored.slice(0, MAX_MATCHES);
}
