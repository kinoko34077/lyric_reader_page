import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonText } from "../assets/js/data-loader.js";

test("JSON parser accepts valid data and rejects malformed input", () => {
  assert.deepEqual(parseJsonText('{"title":"demo"}'), { title: "demo" });
  assert.throws(() => parseJsonText("{invalid"), /JSON文書の形式が不正/);
  assert.throws(() => parseJsonText("x".repeat(500_001)), /JSON文書が大きすぎ/);
});
