import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const EXTS = new Set([".ts", ".json", ".md", ".html", ".css", ".bat"]);
const ROOT = process.cwd();
const SKIP = new Set(["node_modules", "dist", "out", ".git", ".run"]);

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (EXTS.has(extname(e).toLowerCase())) acc.push(p);
  }
  return acc;
}

const MOJIBAKE = /[\u0420\u0421][\u0402-\u040f\u0450-\u045f\u2018-\u203a]/g;
let errors = 0;
for (const f of walk(ROOT)) {
  const buf = readFileSync(f);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    console.error(`${f}: BOM`); errors++; continue;
  }
  let text: string;
  try { text = buf.toString("utf-8"); } catch { console.error(`${f}: not UTF-8`); errors++; continue; }
  if (text.includes("\uFFFD")) { console.error(`${f}: U+FFFD`); errors++; }
  const matches = text.match(MOJIBAKE) || [];
  if (matches.length >= 4) { console.error(`${f}: mojibake (${matches.length})`); errors++; }
}
console.log(errors === 0 ? "check:text OK" : `check:text FAILED: ${errors}`);
process.exit(errors === 0 ? 0 : 1);
