import test from "node:test";
import assert from "node:assert/strict";
import { isReaderJsonFile, parseJsonText } from "../assets/js/data-loader.js";

test("JSON parser accepts valid data and rejects malformed input", () => {
  assert.deepEqual(parseJsonText('{"title":"demo"}'), { title: "demo" });
  assert.throws(() => parseJsonText("{invalid"), /JSON文書の形式が不正/);
  assert.throws(() => parseJsonText("x".repeat(500_001)), /JSON文書が大きすぎ/);
});

test("provisional presentation at the start of a TXT is never classified as JSON", () => {
  assert.equal(isReaderJsonFile("song.txt", "text/plain"), false);
  assert.equal(isReaderJsonFile("song.json", "text/plain"), true);
  assert.equal(isReaderJsonFile("song", "application/json"), true);
  assert.equal(isReaderJsonFile("", "", '{"content":"本文"}'), true);
  assert.equal(isReaderJsonFile("", "", "[文字]{c=2}\n本文"), false);
});
