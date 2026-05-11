# msstate-policies-mcp

MCP server exposing Mississippi State University's current Operating Policies (<https://www.policies.msstate.edu/current>) **and** six MSU academic-date sources (registrar academic + exam calendars, university holidays, graduate school PDFs, financial aid, housing). **Unofficial — not affiliated with MSU. Always verify against the official source.**

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
**Calendars (v0.4.0+):** `find_msu_date`, `get_msu_calendar`
**Diagnostics:** `health_check`

See the [root README](../README.md#what-this-does) for tool descriptions and example responses.

## Environment variables

| Variable | Effect |
|---|---|
| `MSSTATE_POLICIES_RETRIEVAL` | `bm25` (default) / `embed` / `hybrid`. See root README for the comparative-eval rationale. |
| `OPENAI_API_KEY` | Required at runtime when `MSSTATE_POLICIES_RETRIEVAL` is `embed` or `hybrid` (for query embedding). Otherwise unused. |
| `MSSTATE_POLICIES_CACHE` | Set to `disk` to enable cross-platform on-disk cache for policy PDFs (24h TTL) via env-paths. Default in-memory only. Calendar rows use in-memory TTL only (24h stable sources, 6h housing). |

All logging goes to **stderr** only — stdout is reserved for MCP JSON-RPC framing.

## Scripts

```bash
npm run build         # bundle src/ → dist/index.js (CJS)
npm run typecheck     # tsc --noEmit
npm test              # tsx --test tests/*.test.ts
npm run audit:pdfs    # download + parse all current PDFs (live; writes eval/audit-*.csv)
npm run embeddings    # build dist/embeddings.json (needs OPENAI_API_KEY)
npm run eval          # run the eval harness against the live MCP
npm run bundle        # build the Claude Project starter zip
```

Maintainers: see [`../docs/BUILD.md`](../docs/BUILD.md) for architecture, decision history, eval methodology, and open issues.

## License

MIT.
