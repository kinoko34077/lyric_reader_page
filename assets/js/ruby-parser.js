const BASE_CHARS = /[一-龯々〆〇ヶヵ]/;
const BASE_RUN = /[一-龯々〆〇ヶヵ]+$/;

export function parseRuby(source) {
  const nodes = [];
  let cursor = 0;
  const pattern = /(?:｜([^《\n]+)|([一-龯々〆〇ヶヵ]+))《([^》\n]+)》/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) nodes.push({ type: "text", value: source.slice(cursor, match.index) });
    const base = match[1] || match[2];
    if (!BASE_RUN.test(base) && !match[1]) { nodes.push({ type: "text", value: match[0] }); }
    else nodes.push({ type: "ruby", base, ruby: match[3], explicit: Boolean(match[1]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) nodes.push({ type: "text", value: source.slice(cursor) });
  return nodes;
}

export function serializeRuby(nodes) { return nodes.map(node => node.type === "ruby" ? `${node.explicit ? "｜" : ""}${node.base}《${node.ruby}》` : node.value).join(""); }
export function isRubyBaseChar(char) { return BASE_CHARS.test(char); }
