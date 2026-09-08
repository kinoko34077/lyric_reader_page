export function firstLineInfo(value, fallback = "無題") {
  const text = String(value ?? "");
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const raw = text.slice(bom);
  const lineEnd = raw.search(/\r?\n/);
  if (lineEnd < 0) return { title: raw.trim() || fallback, body: "", bodyStart: text.length, newline: "" };
  const newline = raw[lineEnd] === "\r" ? "\r\n" : "\n";
  return { title: raw.slice(0, lineEnd).trim() || fallback, body: raw.slice(lineEnd + newline.length), bodyStart: bom + lineEnd + newline.length, newline };
}

/**
 * Rebuild a first-line-title Source without joining a newly-created body to
 * the title when the original file contained only one line.
 */
export function withFirstLineBody(value, body) {
  const text = String(value ?? "");
  const info = firstLineInfo(text);
  const nextBody = String(body ?? "");
  if (!nextBody) return text.slice(0, info.bodyStart);
  if (info.newline) return text.slice(0, info.bodyStart) + nextBody;
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const title = text.slice(bom.length).split(/\r?\n/, 1)[0];
  return `${bom}${title}\n${nextBody}`;
}
