/**
 * Regression test for the v1.0.0/v1.0.1 stdio-bundle calendar bug, applied
 * pre-emptively to dining: spawns dist/index.js, calls a dining tool over
 * stdio JSON-RPC, asserts the bundled corpus loads cleanly.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(here, "..", "dist", "index.js");

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: { content?: Array<{ text?: string }> };
  error?: { code: number; message: string };
}

function callBundle(payloads: object[], waitForId: number, timeoutMs = 25_000): Promise<JsonRpcResponse[]> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn("node", [DIST], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let stderr = "";
    const responses: JsonRpcResponse[] = [];
    let resolved = false;

    function finish(err?: Error): void {
      if (resolved) return;
      resolved = true;
      proc.kill("SIGTERM");
      if (err) rejectP(err);
      else resolveP(responses);
    }

    proc.stdout.on("data", (b: Buffer) => {
      out += b.toString();
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("{")) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          responses.push(msg);
          if (msg.id === waitForId) finish();
        } catch { /* ignore */ }
      }
    });
    proc.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
    proc.on("error", (err) => finish(err));

    for (const p of payloads) proc.stdin.write(JSON.stringify(p) + "\n");

    setTimeout(() => {
      finish(new Error(`timed out waiting for response id=${waitForId}.\nstderr_tail=${stderr.slice(-600)}`));
    }, timeoutMs);
  });
}

describe("stdio bundle - dining tools work after corpus load", () => {
  test("dist/index.js exists and is non-empty", () => {
    assert.ok(existsSync(DIST), `dist/index.js missing at ${DIST} - run npm run build`);
    assert.ok(statSync(DIST).size > 1_000_000);
  });

  test("list_msu_dining_locations returns non-empty matches via stdio bundle", async () => {
    const responses = await callBundle(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "regression", version: "0.0.0" } } },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_msu_dining_locations", arguments: {} } },
      ],
      2,
      25_000,
    );
    const call = responses.find((r) => r.id === 2);
    assert.ok(call, "no response to tools/call id=2");
    assert.equal(call.error, undefined, `tool errored: ${JSON.stringify(call.error)}`);
    const text = call.result?.content?.[0]?.text;
    assert.ok(typeof text === "string");
    const parsed = JSON.parse(text) as { matches?: unknown[]; total?: number };
    assert.ok(Array.isArray(parsed.matches));
    assert.ok((parsed.total ?? 0) > 0, "dining corpus appears empty in the built bundle");
  });
});
