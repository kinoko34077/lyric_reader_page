export function firstLineInfo(value, fallback = "無題") {
  const text = String(value ?? "");
  const bom = text.startsWith("\uFEFF") ? 1 : 0;
  const raw = text.slice(bom);
  const lineEnd = raw.search(/\r?\n/);
  if (lineEnd < 0) return { title: raw.trim() || fallback, body: "", bodyStart: text.length, newline: "" };
  const newline = raw[lineEnd] === "\r" ? "\r\n" : "\n";
  return { title: raw.slice(0, lineEnd).trim() || fallback, body: raw.slice(lineEnd + newline.length), bodyStart: bom + lineEnd + newline.length, newline };
}
