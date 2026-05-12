# msstate-policies-mcp

MCP server exposing Mississippi State University's current Operating Policies (<https://www.policies.msstate.edu/current>) **and** six MSU academic-date sources (registrar academic + exam calendars, university holidays, graduate school PDFs, financial aid, housing). **Unofficial — not affiliated with MSU. Always verify against the official source.**

Current version: **v0.5.0** (2026-05-12). Calendar retrieval now uses BM25 over a 4-field weighted index where the `synonyms` field is populated at **build time** by Anthropic Claude Haiku — runtime stays pure BM25 with **zero third-party API calls**.

This is the publishable npm package and the Claude Code plugin source. See the [repository root README](../README.md) for the user-facing walkthrough, install paths, and what to expect from a response.

## Install (plain MCP)

```bash
npx -y msstate-policies-mcp
```

…or from a local checkout:

```bash
node /path/to/msstate-mcp/msstate-policies/dist/index.js
```

## Tools (7)

**Policies:** `search_policies`, `get_policy`, `chain_find_relevant_policies`, `cite_policy`
**Calendars (v0.4.0+, synonyms-aware in v0.5.0):** `find_msu_date`, `get_msu_calendar`
**Diagnostics:** `health_check`

See the [root README](../README.md#tools) for tool descriptions and example responses.

## Environment variables

### Runtime (consumer-facing)

| Variable | Effect |
|---|---|
| `MSSTATE_POLICIES_RETRIEVAL` | `bm25` (default) / `embed` / `hybrid`. **Policy** search only. See root README for the comparative-eval rationale. |
| `OPENAI_API_KEY` | Required at runtime when `MSSTATE_POLICIES_RETRIEVAL` is `embed` or `hybrid` (for query embedding). Otherwise unused. |
| `MSSTATE_POLICIES_CACHE` | Set to `disk` to enable cross-platform on-disk cache for policy PDFs (24h TTL) via env-paths. Default in-memory only. Calendar rows use in-memory TTL only (24h stable sources, 6h housing). |

**Calendar retrieval is always BM25-with-synonyms at runtime — no API key, no env var, no cost.** Synonyms ship inside the package's `dist/calendar-synonyms.json` sidecar.

### Build-time (rebuilders only)

| Variable | Required when | Effect |
|---|---|---|
| `ANTHROPIC_API_KEY` | Running `node scripts/build-worker-corpus.mjs` | Generates v0.5.0 synonyms. **Never read at runtime** — mechanically enforced by SYN4 in `tools/security-checklist.sh`. |

All logging goes to **stderr** only — stdout is reserved for MCP JSON-RPC framing.

## Scripts

```bash
npm run build         # bundle src/ → dist/index.js (CJS)
npm run typecheck     # tsc --noEmit
npm test              # tsx --test tests/*.test.ts
npm run audit:pdfs    # download + parse all current PDFs (live; writes eval/audit-*.csv)
npm run embeddings    # build dist/embeddings.json for POLICY search (needs OPENAI_API_KEY)
npm run eval          # run the policy eval harness against the live MCP
npm run eval:synonyms # v0.5.0 calendar synonyms eval — pure BM25, zero API cost
npm run bundle        # build the Claude Project starter zip (released as dist-bundle/)
```

Full corpus rebuild (Worker + sidecar) — runs scrape + v0.5.0 paraphrase pass:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
node ../scripts/build-worker-corpus.mjs
```

Cached by content hash — incremental rebuilds re-paraphrase only changed rows (typically <\$0.05). Full rebuild: ~\$0.50, ~25 minutes (concurrency 2, tuned for Anthropic tier-1 rate limits).

Maintainers: see [`../docs/BUILD.md`](../docs/BUILD.md) for architecture, decision history, eval methodology, and open issues.

## License

MIT.
