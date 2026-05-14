/**
 * Dining scraper. Build-time only - never invoked at MCP request time.
 *
 * Two-pass:
 *   Pass 1 - cheerio fetch /en/sitemap, parseSitemapLocations -> slug list.
 *   Pass 2 - Playwright sequential: open each /en/location/<slug>, click
 *            "This Week's Hours" to open the modal, scrape rendered DOM via
 *            parseLocationHoursDom.
 *
 * Polite-scraping: realistic Chrome UA from a 3-UA pool (one per cron run),
 * sequential (concurrency=1), jitter 1500-4500ms between fetches, random
 * scroll 2-4 increments before reading the DOM, session storageState reused
 * for the full run.
 *
 * Playwright is injected so unit tests can stub it; production passes the
 * real `playwright` module via _scrape-dining.ts.
 */
import {
  DINING_ROOTS,
  DiningWafError,
  type DiningLocation,
} from "./types.js";
import {
  parseSitemapLocations,
  parseLocationHoursDom,
} from "./parser.js";

const ALLOWED_HOST = "msstatedining.mydininghub.com";
const SITEMAP_URL = "https://msstatedining.mydininghub.com/en/sitemap";

const UA_POOL = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
];

const X_SOURCE_HEADER = "msstate-policies-mcp";
const SCRAPE_VERSION = "1.1.0";

export function isAllowedDiningUrl(
  url: string,
  allowedSlugs?: Set<string>,
): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (DINING_ROOTS.includes(url as typeof DINING_ROOTS[number])) return true;
  if (u.host !== ALLOWED_HOST) return false;
  if (u.pathname === "/en/sitemap") return true;
  const m = u.pathname.match(/^\/en\/location\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/i);
  if (m && allowedSlugs && allowedSlugs.has(m[1])) return true;
  return false;
}

export function detectDiningWaf(body: string): boolean {
  if (body.includes("Just a moment...")) return true;
  if (body.includes("cf-chl-bypass")) return true;
  if (/<meta\s+http-equiv=["']refresh["'][^>]+url=[^>]*token=/i.test(body)) return true;
  return false;
}

function pickUa(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function jitter(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = [500, 1500, 4000];
const FETCH_RETRIES = 2;

async function fetchOnce(url: string, ua: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua, "X-Source": `${X_SOURCE_HEADER}/${SCRAPE_VERSION}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const text = await res.text();
    if (detectDiningWaf(text)) throw new DiningWafError(url);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string, ua: string): Promise<string> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try { return await fetchOnce(url, ua); }
    catch (err) {
      lastErr = err;
      if (err instanceof DiningWafError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP\s+4\d{2}/.test(msg)) throw err;
      if (attempt < FETCH_RETRIES) await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Minimal Playwright surface area - lets tests stub. */
export interface PlaywrightLocator {
  count: () => Promise<number>;
  first: () => { click: (opts?: { timeout?: number }) => Promise<unknown> };
}
export interface PlaywrightPage {
  goto: (url: string, opts?: { waitUntil?: "networkidle"; timeout?: number }) => Promise<unknown>;
  waitForLoadState: (state?: "networkidle") => Promise<unknown>;
  waitForSelector: (selector: string, opts?: { timeout?: number }) => Promise<unknown>;
  waitForTimeout: (ms: number) => Promise<unknown>;
  evaluate: (fn: () => unknown) => Promise<unknown>;
  content: () => Promise<string>;
  getByRole: (role: string, opts?: { name?: RegExp }) => PlaywrightLocator;
  close: () => Promise<void>;
}
export interface PlaywrightContext {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}
export interface PlaywrightBrowser {
  newContext: (opts?: { userAgent?: string; extraHTTPHeaders?: Record<string, string> }) => Promise<PlaywrightContext>;
  close: () => Promise<void>;
}
export interface PlaywrightLike {
  chromium: {
    launch: (opts?: { headless?: boolean }) => Promise<PlaywrightBrowser>;
  };
}

async function randomScroll(page: PlaywrightPage): Promise<void> {
  await page.evaluate(async () => {
    const rounds = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rounds; i++) {
      window.scrollBy(0, 300 + Math.floor(Math.random() * 500));
      await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 300)));
    }
  });
}

async function expandHoursModalIfPresent(page: PlaywrightPage): Promise<void> {
  // The location page renders a "This Week's Hours" button. Click it to open
  // the <dialog data-testid="modal"> containing the per-day rows. Some venues
  // may not have this button (closed permanently, etc.) - best-effort.
  try {
    const btn = page.getByRole("button", { name: /This Week's Hours/i });
    if ((await btn.count()) > 0) {
      await btn.first().click({ timeout: 5_000 });
      await page.waitForSelector("dialog[data-testid='modal']", { timeout: 5_000 });
      await page.waitForTimeout(800);
    }
  } catch {
    // best-effort
  }
}

async function politeFetch(page: PlaywrightPage, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "networkidle", timeout: FETCH_TIMEOUT_MS });
  await jitter(500, 1500);
  await randomScroll(page);
  await jitter(500, 1500);
  await expandHoursModalIfPresent(page);
  const html = await page.content();
  if (detectDiningWaf(html)) throw new DiningWafError(url);
  return html;
}

export interface ScrapeAllOptions {
  playwright?: PlaywrightLike;
  fetchHtml?: (url: string) => Promise<string>;
}

export interface ScrapeAllResult {
  locations: DiningLocation[];
  per_source: Record<string, { ok: boolean; error: string | null }>;
  anyError: boolean;
}

export async function scrapeAllDining(opts: ScrapeAllOptions = {}): Promise<ScrapeAllResult> {
  const retrieved_at = new Date().toISOString();
  const per_source: Record<string, { ok: boolean; error: string | null }> = {};
  let anyError = false;

  const ua = pickUa();
  const rawFetch = opts.fetchHtml ?? ((url: string) => fetchWithRetry(url, ua));

  // -- Pass 1: cheerio fetch /en/sitemap ----------------------------------
  let indexEntries: ReturnType<typeof parseSitemapLocations> = [];
  try {
    const html = await rawFetch(SITEMAP_URL);
    indexEntries = parseSitemapLocations(html, SITEMAP_URL);
    per_source["sitemap"] = {
      ok: indexEntries.length > 0,
      error: indexEntries.length === 0 ? "0 entries parsed" : null,
    };
    if (indexEntries.length === 0) anyError = true;
  } catch (e) {
    per_source["sitemap"] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    anyError = true;
  }

  const allowedSlugs = new Set(indexEntries.map((e) => e.slug));

  // -- Pass 2: Playwright sequential per-location -------------------------
  const locations: DiningLocation[] = [];
  const playwright = opts.playwright;
  if (!playwright && !opts.fetchHtml) {
    throw new Error("scrapeAllDining: must provide either playwright or fetchHtml");
  }

  let browser: Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>> | null = null;
  let context: PlaywrightContext | null = null;
  let page: PlaywrightPage | null = null;
  if (playwright) {
    browser = await playwright.chromium.launch({ headless: true });
    // NOTE: Do NOT set extraHTTPHeaders here. The X-Source custom header
    // identifies this scraper to polite-scraping logs when used in plain HTTP
    // fetch calls, but Touchpoint's CDN/WAF interprets it as a bot signal on
    // browser-initiated requests and redirects all /en/location/* pages to
    // /en/locations (the listing page), breaking the per-location scrape.
    context = await browser.newContext({ userAgent: ua });
    page = await context.newPage();
  }

  try {
    for (const entry of indexEntries) {
      const url = entry.url;
      if (!isAllowedDiningUrl(url, allowedSlugs)) {
        per_source[`location/${entry.slug}`] = { ok: false, error: `URL not in allowlist: ${url}` };
        anyError = true;
        continue;
      }
      try {
        const html = page ? await politeFetch(page, url) : await rawFetch(url);
        const loc = parseLocationHoursDom(html, entry.slug, url);
        loc.retrieved_at = retrieved_at;
        if (!loc.name) loc.name = entry.name;
        locations.push(loc);
        per_source[`location/${entry.slug}`] = { ok: true, error: null };
      } catch (e) {
        if (e instanceof DiningWafError) throw e;
        per_source[`location/${entry.slug}`] = { ok: false, error: e instanceof Error ? e.message : String(e) };
        anyError = true;
        const msg = e instanceof Error ? e.message : String(e);
        const warning = /timeout/i.test(msg) ? "page_timeout" : "no_hours_extracted";
        locations.push({
          slug: entry.slug,
          name: entry.name,
          url,
          hours_by_day: [],
          hours_today: null,
          hours_raw_text: "",
          meal_periods_today: [],
          parse_warnings: [warning],
          retrieved_at,
        });
      }
      if (page) await jitter(1500, 4500);
    }
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  return { locations, per_source, anyError };
}
