# Security Evaluation — msstate-mcp

**Audit:** `$autoresearch security` (extended abuse-case sweep)
**Date:** 2026-05-08 17:55 UTC
**Working tree at audit time:** `main` @ `fd6ad40` (plus uncommitted corpus-rule round-2 edits in `scraper.ts`, `chain_find_relevant.ts`, `types.ts`)
**Scope:** entire repo (Worker + local MCP + scripts + CI), excluding `node_modules`, `dist/`, `eval/`
**Verify-metric baseline at audit time:** `bash tools/security-checklist.sh` → **100/100** (every existing H/M/L check PASS)

---

## Resolution status (closed 2026-05-08 ~18:30 UTC)

All ten findings (N1–N10) plus the §1 disclaimer landed in a bounded `$autoresearch` loop. Verify-metric extended to 192 max and rebased; final score **192/192**, every check PASS, guard (tests + typecheck) clean throughout.

| Finding | Severity | Resolution | Commit |
|---|---|---|---|
| **N1** Worker parse-error path | Medium | Generic message + server-side `console.error({ name })` | `bdf8d51` |
| **N2** `worker/corpus.json` integrity | Medium | Sanity check (`indexRowCount >= 200`, all bodies >= 200 chars) added to `tools/security-checklist.sh`; CI now runs the script (N6) | `5b95b28` (scaffolding) + `f2490ad` (CI gate) |
| **N3** esbuild moderate CVE | Medium | Bumped to `^0.28.0`; `dist/index.js` rebuilt; `npm audit --audit-level=moderate` clean | `a84af64` |
| **N4** Worker body-size cap | Low | `Content-Length > 64_000` → 413 before `request.json()` | `98131fe` |
| **N5** Worker `console.error` payload | Low | Logs structured `{ method, name, message }`, not bare `err` | `7c65183` |
| **N6** CI security gate | Low | `npm audit --audit-level=high` (both packages) + `tools/security-checklist.sh` >= 100 gate in `.github/workflows/ci.yml` | `f2490ad` |
| **N7** WAF detection in build script | Low | `looksLikeWafChallenge()` ported into `scripts/build-worker-corpus.mjs`; build aborts on hit | `37a45f8` |
| **N8** `new Function` in stdio entry | Info | Replaced with `typeof __VERSION__ !== "undefined"` guards | `aac2ff1` |
| **N9** Disk cache file mode | Info | `mkdirSync({ mode: 0o700 })` + `writeFileSync({ mode: 0o600 })` | `2b67575` |
| **N10** CORS `Authorization` header | Info | Removed from `Access-Control-Allow-Headers` | `ef494ff` |
| **§1 DISC** Out-of-scope disclaimer | n/a | New `## Out of scope: client-side circumvention` section in `SECURITY.md` covering local edits, prompt-level circumvention, fork-the-corpus, LLM hallucination, and PDF-content prompt injection | `5c799d3` |
| **Verify-metric extension** | n/a | `tools/security-checklist.sh` extended from 100 → 192 pts with N1–N10 + DISC; G4 check in `tools/corpus-rule-checklist.sh` widened to numeric `>= 100` | `5b95b28` |

**Loop stats:** baseline 112 → final 192. 10/15 iterations used. 100% keep rate, 0 discards, 0 guard failures. Per-iteration log: `security/260508-1755-fix-loop/results.tsv`.

**Still outstanding (out-of-band, not part of the loop):**
- Rotate the npm token used for `msstate-policies-mcp@0.2.0` publish.
- Revoke the Cloudflare API token used to deploy the Worker.

The remaining sections below document the audit *as it stood at discovery time* and are preserved as the historical record. They are no longer the live state of the repo.

---

## 1. Out of scope (explicit non-responsibilities)

The MCP server is unauthenticated, read-only, and exposes a public corpus that anyone can already fetch directly from `policies.msstate.edu`. Several abuse classes that come up in MCP threat-modelling are therefore **out of this server's threat model**, and the maintainer disclaims responsibility for them. They should be called out in `SECURITY.md` so users are not misled:

| Behavior | Why out of scope |
|---|---|
| User downloads the published bundle, edits `dist/index.js` locally, and serves modified "policies" to their own LLM client | The user owns their local machine and their own LLM. We have no enforcement story across that boundary, and no claim of authority over what runs there. |
| User instructs the LLM to ignore the tool description rules (verbatim quote, citation, refusal-on-low-confidence) and to "just answer from training data" | The tool description is a *suggestion* to the model; the model and its operator are the trust principals here. We can't prevent prompt-level circumvention, and pretending we can would be a worse failure mode than disclaiming it. |
| User runs `npx msstate-policies-mcp` and points it at a forked corpus or a non-MSU mirror | Same boundary — local execution, local trust. The corpus rule only binds the *maintainer* of this repo, not consumers of the published artifact. |
| LLM hallucinates an answer despite the tool returning empty results / refusing | Out of our control; the in-payload `disclaimer` and the gating logic are best-effort hints to the model, not enforcement. |
| Indirect prompt injection embedded inside MSU policy PDFs themselves (e.g. an attacker who got something published into an OP) | The defense lives upstream at MSU's policy authoring/review process. We faithfully relay the published text. |

**Recommendation:** add an `## Out of scope` section to `SECURITY.md` quoting the four points above. (See §6.)

---

## 2. Threat model (assets × trust boundaries)

### Assets
| Asset | Sensitivity | Notes |
|---|---|---|
| Policy text corpus (PDFs, parsed text) | Low — fully public | Trust anchor is `policies.msstate.edu` over TLS |
| `worker/corpus.json` (committed) | Medium — substituting it changes every Worker answer | No integrity check; trust = git push gate |
| `msstate-policies/dist/index.js` (committed, npm-published) | Medium — same | Has CI integrity guard (`git diff --exit-code dist/`) |
| Cloudflare Worker | Medium — its quota is shared with the maintainer's CF account | No app-level rate limit (deferred M1) |
| npm publish identity (`mminsub90`) | High — supply-chain attack vector | Token rotation is the user's outstanding manual action |
| Cloudflare API token used to deploy | High — could re-deploy malicious Worker | Revocation is the user's outstanding manual action |
| Local user's filesystem + LLM session | Out of scope | See §1 |

### Trust boundaries
1. **Public internet → Cloudflare Worker** — the only externally-reachable surface
2. **Maintainer's machine → npm registry** — supply-chain push gate
3. **Maintainer's machine → Cloudflare** — deploy gate
4. **GitHub push → CI → committed `dist/` artifacts** — covered for the local server, weak for the Worker corpus (see N2)
5. **`policies.msstate.edu` → build script** — TLS-only trust anchor; no signature/hash anchor

### STRIDE coverage
| | Tested | Findings |
|---|---|---|
| Spoofing | yes | None new (no auth surface to spoof; corpus rule is the social anchor) |
| Tampering | yes | N2, N3, N7 |
| Repudiation | yes | N6 |
| Info Disclosure | yes | N1, N5, N9 |
| Denial of Service | yes | N4 (existing M1 also still deferred) |
| Elevation of Privilege | yes | N/A — no privilege levels on the Worker, and no shell-out from request handlers |

---

## 3. Verify-metric checklist — current state

`tools/security-checklist.sh` outputs **100/100**. All previously-tracked items pass:

| ID | Item | Status | Commit |
|---|---|---|---|
| H1 | Worker input length guard | PASS | `cff4b37` |
| H2 | Worker handler errors don't echo `err.message` | PASS (but see N1) | `eb32f5e` |
| H3a | `msstate-policies` audit clean (high/critical) | PASS | (already clean) |
| H3b | Worker audit clean | PASS | `e55a0da` (wrangler v4) |
| M3 | `SECURITY.md` reporting + supported versions | PASS | `faa3ec6` |
| M4 | Dependabot config (npm + GH Actions) | PASS | `aeb6d91` |
| M5 | npm `--provenance` documented | PASS | `bad6994` |
| L1 | Threat model in `docs/BUILD.md` | PASS | `bad6994` |
| L2 | `## Security` heading in `docs/BUILD.md` | PASS | `bad6994` |
| L4 | Corpus rule documented as trust anchor | PASS | `bad6994` |
| Guard | `npm test` passes (msstate-policies) | PASS | — |
| Guard | typecheck clean (both packages) | PASS | — |

**Conclusion on the existing checklist: solid.** What follows is net-new, surfaced by widening the lens beyond the checklist.

---

## 4. New findings (net-new beyond existing checklist)

10 findings, severity-ranked. Every finding has a code reference. Two of them (N1, N2) are gaps where the verify metric *thinks* coverage is complete but isn't.

### N1 — Medium · A05 · Info Disclosure — Parse-error path still echoes `err.message`

- **Location:** `worker/src/index.ts:519`
- **Confidence:** Confirmed
- **Problem:** The H2 commit (`eb32f5e`) replaced `Internal error: ${err.message}` in the *handler*-error path, but the JSON-parse error path was not updated:
  ```ts
  // worker/src/index.ts:514-523 (current)
  } catch (err) {
    return withCors(
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: `Parse error: ${(err as Error).message}` },
        }),
        ...
  ```
  Standard JS `JSON.parse` errors are mostly low-signal (`Unexpected token } in JSON at position 13`), but the same pattern that motivated H2 — *don't echo internal exception text on a public endpoint* — applies here too.
- **Why the verify metric missed it:** `tools/security-checklist.sh` line 30 greps for the literal string `Internal error: ${`. It does not catch the equivalent `Parse error: ${` pattern. The verify check is a string-match, not a semantic check.
- **Mitigation:**
  ```ts
  } catch (err) {
    console.error("MCP parse error", err);   // server-side log
    return withCors(new Response(
      JSON.stringify({
        jsonrpc: "2.0", id: null,
        error: { code: -32700, message: "Parse error. Body must be valid JSON-RPC 2.0." },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
  }
  ```
  Then broaden the H2 grep in `tools/security-checklist.sh` to `grep -qE '(Internal|Parse) error: \$\{'` so the gap doesn't reopen.

### N2 — Medium · A08 · Tampering — `worker/corpus.json` has no integrity guard in CI

- **Location:** `worker/src/index.ts:17` (`import corpusData from "../corpus.json"`); CI: `.github/workflows/ci.yml`
- **Confidence:** Confirmed
- **Problem:** The CI workflow's `git diff --exit-code dist/` step (line 34) ensures the committed `msstate-policies/dist/index.js` matches what `npm run build` produces — i.e. an attacker who alters source without re-running build is caught. There is **no equivalent guardrail for `worker/corpus.json`**. A push that hand-edits `worker/corpus.json` (or a build pipeline mistake that ships a partial / WAF-poisoned corpus) lands in CI and gets deployed by a subsequent `wrangler deploy` with no signal.
- **Blast radius today:** small — single maintainer, manual deploys, branch is rarely pushed to. But the same pattern would be load-bearing once M6 (auto-rebuild + auto-deploy) lands. Pre-fixing now is cheap.
- **Mitigation (one of):**
  - Cheapest: in CI, run `python3 -c 'import json; d=json.load(open("worker/corpus.json")); assert d["indexRowCount"] >= 200; assert all(len(p["text"]) > 200 for p in d["policies"]); print("ok")'` so a degraded corpus fails the build.
  - Stronger: extend `tools/security-checklist.sh` with a Worker-corpus sanity check (`indexRowCount >= 200`, non-empty `policies[].text` for >=200 entries) and gate it via `Guard:` in any future autoresearch run.
  - Strongest: include a hash check in the Worker's `health_check` response (`sha256(corpus.json)`); makes drift externally observable.

### N3 — Medium · A06 · Vulnerable Components — `esbuild` devDep moderate CVE outside the audit gate

- **Location:** `msstate-policies/package.json:38` (`"esbuild": "^0.23.0"` resolves to a version with a moderate advisory)
- **Confidence:** Confirmed (`npm audit` reports `moderate=1` against `esbuild`; fix is the SemVer-major bump to `0.28.0`)
- **Problem:** The H3a verify check uses `--audit-level=high`, so moderate findings on the build toolchain don't block the score. The advisory is in dev tooling (build-time only, not shipped to npm consumers via `dist/`), so end-user blast radius is zero — but a developer building from source runs the vulnerable version. esbuild has had a meaningful pace of advisories; staying within ~3 minor versions of latest is the standard hardening posture for build tools.
- **Mitigation:** bump `esbuild` to `^0.28.0` in `msstate-policies/package.json`, run `npm install`, run `npm run build`, commit the resulting `dist/` change as a normal experiment. Then either leave the H3a gate at `--audit-level=high` (status quo) or tighten to `--audit-level=moderate` and document the reasoning.

### N4 — Low · A04 · DoS — No body-size cap before `request.json()`

- **Location:** `worker/src/index.ts:512`
- **Confidence:** Likely (theoretical; CF's 100MB default cap softens it)
- **Problem:** `MAX_QUERY_CHARS = 4096` (line 272) is enforced after `request.json()` has already parsed the body. A 50MB JSON-RPC body whose `params.arguments.query` is 10 chars sails past the H1 guard at the cost of CPU spent parsing JSON. CF Workers' per-invocation CPU is bounded (10ms free / 30s paid), so a single request can't OOM the isolate; but every invocation still costs request-quota.
- **Mitigation:** check `request.headers.get("content-length")` before consuming the body:
  ```ts
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 64_000) {
    return withCors(new Response(
      JSON.stringify({ jsonrpc: "2.0", id: null,
        error: { code: -32600, message: "Request too large." } }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    ));
  }
  ```
  Pairs cleanly with the existing M1 (rate-limit) deferral.

### N5 — Low · A05 · Info Disclosure — Worker logs raw `err` to CF observability

- **Location:** `worker/src/index.ts:541` (`console.error("MCP handler error", err)`); `worker/wrangler.toml:21-22` (`[observability] enabled = true`)
- **Confidence:** Likely
- **Problem:** Cloudflare Workers Logs captures `console.error` payloads. Logging the raw `err` object includes its `.stack`, which leaks internal paths and the bundled-source line numbers. Visible only to the CF dashboard (single-maintainer today, so blast radius is the maintainer themselves), but if the CF account is ever compromised — or if log retention extends after maintainer change — those stacks become an internal-architecture leak.
- **Mitigation:** log only what's actionable for ops:
  ```ts
  console.error("MCP handler error", {
    method: body.method,
    name: (err as Error)?.name,
    message: (err as Error)?.message,   // server-side only, still does not return to client
  });
  ```
  Drop the bare `err` reference so the platform logger doesn't auto-serialize the stack.

### N6 — Low · A09 · Repudiation — CI doesn't run the security-checklist or `npm audit` gate

- **Location:** `.github/workflows/ci.yml`
- **Confidence:** Confirmed
- **Problem:** `tools/security-checklist.sh` is the verify metric for the security-fix loop, but it's never run in CI. A regression that drops the score from 100 to (say) 86 doesn't fail any push or PR. Same for `npm audit` — Dependabot opens PRs out-of-band, but a hand-merged dep change can introduce a high/critical without CI catching it. This is a "monitoring failure" finding (A09) more than an exploit.
- **Mitigation:** add to the CI matrix:
  ```yaml
  - name: Security checklist gate
    run: bash tools/security-checklist.sh | tee /tmp/score.txt
      && [ "$(tail -n1 /tmp/score.txt)" = "100" ]
  - name: npm audit (high/critical)
    working-directory: msstate-policies
    run: npm audit --audit-level=high
  - name: Worker npm audit (high/critical)
    working-directory: worker
    run: npm audit --audit-level=high
  ```
  This converts the deferred social contract ("rerun the checklist before each release") into a mechanical gate.

### N7 — Low · A08 · Tampering — `build-worker-corpus.mjs` has no WAF detection

- **Location:** `scripts/build-worker-corpus.mjs:42-46` (`fetchText`)
- **Confidence:** Likely (will become Confirmed if/when M6 lands)
- **Problem:** The runtime scraper (`msstate-policies/src/http.ts`) calls `looksLikeWafChallenge` and throws `WAFChallengeError`. The build script does not. If the build runs while MSU's F5 / Cloudflare interstitial is being served, the script saves the WAF page text into `corpus.json` and exits "successfully" — only the per-policy `text.length < 200` skip catches it (line 119), and that's a per-PDF check, not the index page. Currently mitigated socially: a human runs the script and watches the console. The moment M6 (scheduled CI rebuild) lands, this becomes a real corpus-poisoning vector.
- **Mitigation:** before the M6 cron lands, port `looksLikeWafChallenge` from `msstate-policies/src/http.ts` into the build script and abort the build on a hit. Same regex set, ~5 lines of code, no new dependency.

### N8 — Info · A05 · Hardening — `new Function()` for runtime-const fallback

- **Location:** `msstate-policies/src/index.ts:46-52`
- **Confidence:** Possible (lint-flag, not exploitable today)
- **Problem:** `getStringConst` uses `new Function` to read `__VERSION__` / `__GIT_SHA__` (set by esbuild's `define`):
  ```ts
  return new Function(`return typeof ${name} !== "undefined" ? ${name} : ""`)();
  ```
  `name` is constrained at the type system to one of two literal values, so the eval is closed-world today. But:
  - any security linter (`eslint-plugin-security`, `no-new-func`) will flag this as an `eval`-class call.
  - if a future maintainer relaxes the type (e.g. `name: string`), it silently becomes a code-eval primitive driven by whatever calls `getStringConst`.
- **Mitigation:** replace with a closed-form check that doesn't construct functions at runtime:
  ```ts
  declare const __VERSION__: string | undefined;
  declare const __GIT_SHA__: string | undefined;
  const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "unknown";
  const GIT_SHA = typeof __GIT_SHA__ !== "undefined" ? __GIT_SHA__ : "unknown";
  ```
  esbuild's `define` rewrites these at build time; no `Function` constructor needed.

### N9 — Info · A05 · Info Disclosure — Disk-cache file mode follows umask

- **Location:** `msstate-policies/src/cache.ts:114` (`writeFileSync(this.persistPath, JSON.stringify(arr))`)
- **Confidence:** Possible
- **Problem:** When `MSSTATE_POLICIES_CACHE=disk` is set, the cache file is written to `~/.cache/msstate-policies-mcp/policy-bodies.json` with the default mode (`0666 & ~umask`). On a multi-user host (think a shared lab machine) other users on the same box can read the cached policy bodies. The bodies are public MSU policy text, so the leak is *content-free* — but the existence and contents of the cache reveal which policies a given user has been asking about (a small but real privacy signal).
- **Mitigation:** pass `{ mode: 0o600 }` to `writeFileSync` and `mkdirSync({ recursive: true, mode: 0o700 })`. Single-line fix.

### N10 — Info · A05 · Hardening — CORS allow-list includes `Authorization`

- **Location:** `worker/src/index.ts:438-441`
- **Confidence:** Confirmed
- **Problem:** `Access-Control-Allow-Headers: Content-Type, Mcp-Session-Id, Authorization`. The Worker has no auth surface — it never reads `Authorization`. Allowing the header is harmless today (no CSRF surface either, since there are no cookies and no per-user state), but it's a confused-deputy hint: a future maintainer might assume auth is wired up because the CORS allow-list says so.
- **Mitigation:** drop `Authorization` from `CORS_HEADERS["Access-Control-Allow-Headers"]` until/unless real auth lands.

---

## 5. Existing items intentionally still deferred (no change recommended)

These are documented in `docs/BUILD.md` -> "Deferred security items" and are NOT findings of this audit; recording them here so the open status is explicit:

| ID | Item | Reason for deferral | Trigger to revisit |
|---|---|---|---|
| M1 | Worker rate limiting | Anonymous public endpoint; CF free-tier limits are an acceptable cap | Real abuse observed in CF logs |
| M2 | GitHub branch protection on `main` | Codespaces token lacks admin scope; single-maintainer repo | Maintainer signs in via GH UI |
| M6 | Auto weekly corpus rebuild | Storing a long-lived CF token in GH Secrets is a meaningful trust shift | Stale-content drift becomes a user complaint |

**Outstanding manual user actions (per session memory, neither blocking nor blocked):**
- Rotate the npm token used for `msstate-policies-mcp@0.2.0`
- Revoke the Cloudflare API token used to deploy the Worker

---

## 6. Recommended remediation order

Priority is by effort × blast-radius, not severity alone.

### Tier 1 — Cheap and high-leverage (do these in one PR)
1. **N1** — fix the Parse-error `err.message` echo in the Worker, and broaden the H2 grep in `tools/security-checklist.sh` so the gap doesn't recur.
2. **N6** — wire `tools/security-checklist.sh` and `npm audit` into `.github/workflows/ci.yml`. Five new lines; converts the social contract into a mechanical one.
3. **N10** — drop `Authorization` from the Worker's CORS allow-list.
4. **§1 disclaimer** — add `## Out of scope` to `SECURITY.md` quoting the user-edits / prompt-circumvention / fork-the-corpus statements above.

### Tier 2 — Defensive depth (next session)
5. **N4** — add a `Content-Length` check to the Worker before `request.json()`.
6. **N5** — strip `err` from `console.error` in the Worker handler-catch.
7. **N2** — add a corpus sanity check (row count + non-empty bodies) to CI.
8. **N3** — bump `esbuild` to `^0.28.0`, regenerate `dist/`.

### Tier 3 — Hardening (no urgency)
9. **N8** — remove `new Function` from `msstate-policies/src/index.ts`.
10. **N9** — set explicit `mode: 0o600` on the disk cache writes.

### Tier 4 — Pre-requisite for M6 only
11. **N7** — port WAF detection into `scripts/build-worker-corpus.mjs` *before* M6 lands.

---

## 7. Coverage summary

```
=== Extended audit (2026-05-08 17:55 UTC) ===
STRIDE Coverage:  S[y] T[y] R[y] I[y] D[y] E[y]  -- 6/6
OWASP Coverage:   A01[-] A02[-] A03[-] A04[y] A05[y] A06[y] A07[-] A08[y] A09[y] A10[-]
                  Tested 5/10. The 5 marked "-" are N/A for this codebase:
                  - A01/A07: no auth surface, no privilege levels to break
                  - A02:    no crypto outside outbound TLS to msstate.edu
                  - A03:    no DB, no shell-out, no template engine, no SQL/NoSQL
                  - A10:    no SSRF surface -- only outbound is to msstate.edu
                            (build-time) and openai.com (eval-time, opt-in)
New findings:     0 Critical / 0 High / 3 Medium (N1, N2, N3) / 4 Low (N4-N7) / 3 Info (N8-N10)
Confirmed: 6 | Likely: 3 | Possible: 1
Verify metric (existing checklist): 100/100 -- unchanged
Composite audit metric: (5/10)*50 + (6/6)*30 + min(10,20) = 65/100
```

The composite is dragged down by OWASP categories that don't apply to this codebase (no auth, no crypto, no SQL, no SSRF). For the categories that *do* apply, coverage is clean and the new findings are mostly Low/Info hardening items.

---

## 8. Headline assessment

**Current security posture: solid for the published surface.** The verify checklist is at 100/100 and everything user-facing (the Worker, the npm package, the plugin install path) holds up under widened scrutiny.

The three Mediums are all *gap* findings, not new vulnerabilities:
- N1 — verify metric had a string-match blind spot
- N2 — `dist/` has a CI integrity gate, `worker/corpus.json` doesn't
- N3 — `npm audit --audit-level=high` lets `moderate` slip through

None expose user data (there is none), none enable RCE, none are reachable without first compromising the maintainer's npm or CF credentials — which lands you in a far worse place than any of these would.

The biggest *real* risk is unrelated to the code: **the npm and Cloudflare tokens used to publish v0.2.0 still need rotating/revoking.** Until those land, the trust anchor for everything downstream is "those two tokens haven't been exfiltrated yet." Closing that loop is higher-impact than any of N1–N10.
