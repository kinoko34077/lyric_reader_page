import assert from "node:assert/strict";
import test from "node:test";
import { runWriterGateSuite } from "./writer-gate-runner.mjs";

test("Writer Browser sub-gates continue after one failure and preserve a failing result", async () => {
  const calls = [];
  const { results, failed } = await runWriterGateSuite([
    ["first", async targetUrl => { calls.push(`first:${targetUrl}`); throw new Error("first failure"); }],
    ["second", async targetUrl => { calls.push(`second:${targetUrl}`); return { status: "PASS", targetUrl }; }]
  ], "fixture://writer");

  assert.deepEqual(calls, ["first:fixture://writer", "second:fixture://writer"]);
  assert.equal(failed, true);
  assert.equal(results.first.status, "FAIL");
  assert.match(results.first.error, /first failure/);
  assert.deepEqual(results.second, { status: "PASS", targetUrl: "fixture://writer" });
});
