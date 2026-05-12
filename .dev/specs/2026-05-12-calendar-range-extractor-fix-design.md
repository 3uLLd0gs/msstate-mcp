# Calendar range extractor fix — design

**Date:** 2026-05-12
**Status:** Approved
**Scope:** Bug fix — registrar term-page extractor
**Author:** session with Claude Opus 4.7

## Problem

The `find_msu_date` and `get_msu_calendar` tools return collapsed single-day rows for events that span multiple days on MSU's registrar academic calendar. The user-visible symptom: querying Fall Break returns only October 8, never the October 9 second day.

In the current corpus (`worker/corpus.json` at v0.6.0), every multi-day academic-calendar and SFA-financial-aid event has `start == end`. The dataset includes (at minimum) Fall Break, Spring Break, faculty advising windows, and graduation application windows — all multi-day, all currently collapsed.

## Root cause

The bug is in HTML extraction, not in the text-based `parseDateRange` regex.

Live MSU registrar HTML structures multi-day events with **two `<time datetime>` elements** in the date column, separated by ` to</br>`:

```html
<div class="col col-md-4">
  <div class="card-body py-4">
    <time datetime="2026-03-09T12:00:00Z">March 9</time>
 to</br><time datetime="2026-03-13T12:00:00Z">March 13</time>
  </div>
</div>
```

`extractAcademicCalendarRows` in `msstate-policies/src/calendars/parsers/term_pages.ts:135` calls `.first()` on the `time[datetime]` query and never reads the second element. Downstream, `parseTermPage` at the same file (lines 269–279) hardcodes `end: r.isoDate`, collapsing every range into the start day.

The text-based `parseDateRange` in `msstate-policies/src/calendars/parsers/date_table.ts` is not on the path for academic_calendar / sfa_financial_aid sources, so adding `"to"` to its separator list would not fix this bug.

## Scope

In scope:
- `extractAcademicCalendarRows` and `parseTermPage` in `term_pages.ts`
- `sfa_financial_aid` source (aliased to the same extractor at `term_pages.ts:245`)

Out of scope:
- `parseDateRange` text parser — not on the affected path
- Housing events (`event_list.ts`) — already handles `"to"` via `parseHousingDate`
- PDF calendar parser (`pdf_calendar.ts`) — dash-normalized regex already works
- University holidays (`date_table.ts:extractUniversityHolidays`) — uses 4-column tables, not `<time>` ranges
- Exam schedule extractor — reads from a different column structure
- `CalendarRow` schema — the `end` field already exists
- Worker code (`worker/src/index.ts`) — already consumes `end`
- Search code (`calendars/search.ts`) — operates on `CalendarRow.end` unchanged
- Pagination of housing events
- Bumping package version (this is a bugfix carried in the next release)

## Solution

### Code change (single file: `term_pages.ts`)

1. Extend the `RawRow` interface with an optional `isoDateEnd?: string`.

2. In `extractAcademicCalendarRows`, after locating the date column (`col-md-4`):
   - Query all `time[datetime]` elements in that column.
   - If the count is ≥ 2, parse the **last** element's `datetime` attribute with the same `^(\d{4}-\d{2}-\d{2})` regex used for the first.
   - Validate that `isoDateEnd >= isoDate` using lexicographic string compare (ISO `YYYY-MM-DD` sorts correctly as strings).
   - If validation fails, drop `isoDateEnd` and emit a stderr warning via `src/log.ts`. Never silently swap or invent a value.

3. In `parseTermPage`, set `end: r.isoDateEnd ?? r.isoDate`. The dedupe key remains `${event}|${r.isoDate}` (keyed on the start date), so adding an end date does not affect dedupe behavior.

### Tests (new fixtures + assertions)

Add unit tests with these cases:

1. **Multi-day range, separator on its own line** — the live registrar pattern. `<time>March 9</time> to</br><time>March 13</time>`. Expect `start = 2026-03-09`, `end = 2026-03-13`.

2. **Single-day event** — only one `<time>` element. Expect `start == end`. Regression guard.

3. **Range crossing month boundary** — `<time>January 28</time> to <time>March 27</time>`. Expect `start = 2026-01-28`, `end = 2026-03-27`.

4. **Malformed second `<time>` (out of order)** — synthetic. Expect: falls back to single-day, stderr warning emitted.

5. **`extractExamScheduleRows` smoke test** — re-run existing exam fixture, confirm row count and first/last row unchanged. Proves the exam extractor (different column path) is untouched.

### Corpus-level guard

In `scripts/build-worker-corpus.mjs`, after the calendar scrape pipeline completes (both academic_calendar and sfa_financial_aid have been written into the corpus object):

- Count rows where `start != end` across the academic_calendar + sfa_financial_aid sources combined.
- If the count is 0, abort with the exact string `"refusing to ship a calendar corpus with zero multi-day ranges"`. This follows the existing canonical abort pattern used elsewhere in the build pipeline (e.g. `"refusing to ship a poisoned calendar corpus"`).

### Security checklist

Add a new check **CAL6** in `tools/security-checklist.sh` that greps for the new abort string. +5 pts. Score moves from 230 → 235.

## Rollout

1. `cd msstate-policies && npm run build` — rebuild bundle.
2. `cd .. && node scripts/build-worker-corpus.mjs` — rescrape corpus. CAL6 guard fires if the extractor regressed.
3. Spot-check `worker/corpus.json` — `grep -A1 '"Fall Break' worker/corpus.json` should show `end` ≠ `start`. Same for Spring Break.
4. `bash tools/security-checklist.sh | tail -1` — confirm score 235.
5. Eval suite is currently scoped to policies + courses; no eval-row changes here.

## Commit shape

Single commit:
- Title: `fix(calendars): extract end date from second <time> in registrar term pages`
- Files touched: `msstate-policies/src/calendars/parsers/term_pages.ts`, new test file under `msstate-policies/tests/`, `scripts/build-worker-corpus.mjs`, `tools/security-checklist.sh`, `msstate-policies/dist/index.js` (rebuild), `worker/corpus.json` (rescrape).

## Risks

- **MSU changes the HTML pattern.** If the registrar switches to a single `<time datetime>` with a `duration` attribute, the new code degrades gracefully (falls back to single-day). Low risk.
- **A stray `<time>` element appears in a malformed page.** The lexicographic-order check (Solution §1.2) and CAL6 corpus assertion (Solution §3) both guard against silent corruption.
- **Existing single-day rows mis-extracted as ranges.** Mitigated by test case #2 (single-day regression guard) and the dedupe-key invariance noted in Solution §1.3.

## Corpus rule compliance

This change does not introduce new data sources or third-party fetches. The extractor reads the same registrar HTML already in the allowlist (`registrar.msstate.edu` per `msstate-policies/src/calendars/types.ts`). No `WebSearch`, no non-MSU fetches, no training-data fallbacks. See `CLAUDE.md` § "CORPUS RULE".
