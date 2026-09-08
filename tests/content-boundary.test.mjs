import test from "node:test";
import assert from "node:assert/strict";
import { firstLineInfo, withFirstLineBody } from "../assets/js/content-boundary.js";

test("first-line title policy handles empty, BOM, one-line, blank, and CRLF sources", () => {
  assert.deepEqual(firstLineInfo(""), { title: "無題", body: "", bodyStart: 0, newline: "" });
  assert.deepEqual(firstLineInfo("\uFEFF"), { title: "無題", body: "", bodyStart: 1, newline: "" });
  assert.deepEqual(firstLineInfo("唯一の行"), { title: "唯一の行", body: "", bodyStart: 4, newline: "" });
  assert.deepEqual(firstLineInfo("  \n本文"), { title: "無題", body: "本文", bodyStart: 3, newline: "\n" });
  assert.deepEqual(firstLineInfo("題\r\n本文"), { title: "題", body: "本文", bodyStart: 3, newline: "\r\n" });
});

test("first-line body reconstruction does not concatenate a new body to a one-line title", () => {
  assert.equal(withFirstLineBody("題名", "本文"), "題名\n本文");
  assert.equal(withFirstLineBody("題名\n旧本文", "新本文"), "題名\n新本文");
  assert.equal(withFirstLineBody("\uFEFF題名", "本文"), "\uFEFF題名\n本文");
  assert.equal(withFirstLineBody("題名\n旧本文", ""), "題名\n");
});
