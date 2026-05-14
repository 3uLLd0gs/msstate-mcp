/**
 * Online-site scraper. Build-time only — never invoked at MCP request time.
 *
 * Two-pass:
 *   Pass 1 — fetch /academic-programs, parse with parseAcademicProgramsIndex
 *            to get the ~126 program slugs + degree levels.
 *   Pass 2 — concurrency-pool fetch each program page + /admissions-process
 *            + /staff + the 5 SUPPORT_PAGE_SLUGS pages, parse each.
 *
 * Mirrors src/tuition/scraper.ts and src/emergency/scraper.ts:
 * URL allowlist + WAF detector + retry-with-backoff + concurrency pool.
 */
import {
  ONLINE_ROOTS,
  SUPPORT_PAGE_SLUGS,
  OnlineWafError,
  type OnlineAdmissionsProcess,
  type OnlineProgram,
  type OnlineStaffEntry,
  type OnlineInfoPage,
} from "./types.js";
import {
  parseAcademicProgramsIndex,
  parseProgramHtml,
  parseAdmissionsProcessHtml,
  parseStaffDirectoryHtml,
  parseSupportPageHtml,
} from "./parser.js";

const ALLOWED_HOST = "www.online.msstate.edu";

export function isAllowedOnlineUrl(
  url: string,
  allowedProgramSlugs?: Set<string>,
): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.host !== ALLOWED_HOST) return false;
  if (ONLINE_ROOTS.includes(url)) return true;
  for (const slug of SUPPORT_PAGE_SLUGS) {
    if (url === `https://www.online.msstate.edu/${slug}`) return true;
  }
  if (allowedProgramSlugs) {
    const m = u.pathname.match(/^\/([a-z][a-z0-9-]*)$/i);
    if (m && allowedProgramSlugs.has(m[1])) return true;
  }
  return false;
}

export function detectOnlineWaf(body: string): boolean {
  if (body.includes("Just a moment...")) return true;
  if (body.includes("cf-chl-bypass")) return true;
  if (/<meta\s+http-equiv=["']refresh["'][^>]+url=[^>]*token=/i.test(body)) return true;
  return false;
}

const UA = "msstate-policies-mcp/1.0.0 (build-worker-corpus)";
const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const JITTER_MIN_MS = 150;
const JITTER_MAX_MS = 500;
const FETCH_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4000];

async function fetchOnce(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (detectOnlineWaf(text)) throw new OnlineWafError(url);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try { return await fetchOnce(url); }
    catch (err) {
      lastErr = err;
      if (err instanceof OnlineWafError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP\s+4\d{2}/.test(msg)) throw err;
      if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function jitter(): Promise<void> {
  const ms = JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
  return new Promise((r) => setTimeout(r, ms));
}

async function pool<I, O>(items: I[], conc: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
      await jitter();
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, worker));
  return out;
}

export interface ScrapeAllOptions {
  fetchUrl?: (url: string) => Promise<string>;
}

export interface ScrapeAllResult {
  programs: OnlineProgram[];
  admissions_process: OnlineAdmissionsProcess;
  staff: OnlineStaffEntry[];
  info_pages: OnlineInfoPage[];
  per_source: Record<string, { ok: boolean; error: string | null }>;
  anyError: boolean;
}

export async function scrapeAllOnline(opts: ScrapeAllOptions = {}): Promise<ScrapeAllResult> {
  const raw = opts.fetchUrl ?? fetchWithRetry;
  const fetcher = async (url: string): Promise<string> => {
    const html = await raw(url);
    if (detectOnlineWaf(html)) throw new OnlineWafError(url);
    return html;
  };
  const retrieved_at = new Date().toISOString();
  const per_source: Record<string, { ok: boolean; error: string | null }> = {};
  let anyError = false;

  // Pass 1: academic-programs index
  const indexUrl = "https://www.online.msstate.edu/academic-programs";
  let indexEntries: ReturnType<typeof parseAcademicProgramsIndex> = [];
  try {
    const html = await fetcher(indexUrl);
    indexEntries = parseAcademicProgramsIndex(html, indexUrl);
    per_source["academic-programs"] = { ok: indexEntries.length > 0, error: indexEntries.length === 0 ? "0 entries parsed" : null };
    if (indexEntries.length === 0) anyError = true;
  } catch (e) {
    per_source["academic-programs"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  const allowedSlugs = new Set(indexEntries.map((e) => e.slug));

  // Pass 2a: per-program pages
  const programResults = await pool(indexEntries, CONCURRENCY, async (entry) => {
    const programUrl = `https://www.online.msstate.edu/${entry.slug}`;
    if (!isAllowedOnlineUrl(programUrl, allowedSlugs)) {
      return { slug: entry.slug, program: null as OnlineProgram | null, error: `URL not in allowlist: ${programUrl}` };
    }
    try {
      const html = await fetcher(programUrl);
      const program = parseProgramHtml(html, entry.slug, entry.degree_level, programUrl);
      if (!program) return { slug: entry.slug, program: null, error: "parse returned null" };
      return { slug: entry.slug, program: { ...program, retrieved_at }, error: null as string | null };
    } catch (e) {
      if (e instanceof OnlineWafError) throw e;
      return { slug: entry.slug, program: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const programs: OnlineProgram[] = [];
  for (const r of programResults) {
    per_source[`program/${r.slug}`] = { ok: r.error === null, error: r.error };
    if (r.error) anyError = true;
    if (r.program) programs.push(r.program);
  }

  // Pass 2b: /admissions-process
  const admissionsUrl = "https://www.online.msstate.edu/admissions-process";
  let admissions_process: OnlineAdmissionsProcess;
  try {
    const html = await fetcher(admissionsUrl);
    admissions_process = { ...parseAdmissionsProcessHtml(html, admissionsUrl), retrieved_at };
    per_source["admissions-process"] = { ok: true, error: null };
  } catch (e) {
    if (e instanceof OnlineWafError) throw e;
    per_source["admissions-process"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
    admissions_process = {
      url: admissionsUrl,
      central_contact: { name: "", title: "", email: null, phone: null },
      shared_prelude: "",
      sections: { undergraduate: "", graduate: "", transfer: "", readmit: "", international: "" },
      application_fee_tiers: [],
      external_apply_urls: [],
      retrieved_at,
    };
  }

  // Pass 2c: /staff
  const staffUrl = "https://www.online.msstate.edu/staff";
  let staff: OnlineStaffEntry[] = [];
  try {
    const html = await fetcher(staffUrl);
    staff = parseStaffDirectoryHtml(html, staffUrl).map((s) => ({ ...s, retrieved_at }));
    per_source["staff"] = { ok: staff.length > 0, error: staff.length === 0 ? "0 entries parsed" : null };
    if (staff.length === 0) anyError = true;
  } catch (e) {
    if (e instanceof OnlineWafError) throw e;
    per_source["staff"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  // Pass 2d: 5 support pages
  const supportResults = await pool(
    [...SUPPORT_PAGE_SLUGS],
    CONCURRENCY,
    async (slug) => {
      const url = `https://www.online.msstate.edu/${slug}`;
      try {
        const html = await fetcher(url);
        return { slug, page: { ...parseSupportPageHtml(html, slug, url), retrieved_at } as OnlineInfoPage, error: null as string | null };
      } catch (e) {
        if (e instanceof OnlineWafError) throw e;
        return { slug, page: null as OnlineInfoPage | null, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  const info_pages: OnlineInfoPage[] = [];
  for (const r of supportResults) {
    per_source[`info/${r.slug}`] = { ok: r.page !== null, error: r.error };
    if (r.error || !r.page) anyError = true;
    if (r.page) info_pages.push(r.page);
  }

  return { programs, admissions_process, staff, info_pages, per_source, anyError };
}
