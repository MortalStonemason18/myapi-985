#!/usr/bin/env node
// Lint the alphabetical ordering of CLI help-text blocks.
//
// Scans every .ts file under packages/cli/src/ for the canonical block
// headers (Commands:, Subcommands:, Namespaces:, Options:, Aliases:) and
// asserts each block's entries are sorted alphabetically by their leading
// identifier — the standing convention for `myapi --help` output.
//
// Multi-line entries (continuation lines indented deeper than the entry)
// are correctly attributed to the entry above them. Lines starting with
// `--flag` are sorted by the flag name without the leading dashes.
//
// Per-block opt-out: add a comment `// lint:help-order skip — <reason>`
// on the line immediately preceding the header to declare an intentional
// non-alphabetical block (e.g. a lifecycle order we want to preserve).
//
// Exit codes:
//   0  all blocks sorted
//   1  one or more blocks out of order

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_ROOT, '..', '..');
const SRC_DIR = path.resolve(PKG_ROOT, 'src');

const HEADERS = new Set([
  'Commands:',
  'Subcommands:',
  'Namespaces:',
  'Options:',
  'Aliases:',
]);

const SKIP_MARKER = /\/\/\s*lint:help-order\s+skip\b/;

function walkTs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

// Extract the leading identifier from an entry line.
//   "  create <name>"        → "create"
//   "  --max-tokens N"       → "max-tokens"
//   "  whoami    → myapi …"  → "whoami"
function entryKey(line) {
  const trimmed = line.replace(/^\s+/, '');
  const m = trimmed.match(/^(?:--?)?([A-Za-z][A-Za-z0-9_-]*)/);
  return m ? m[1] : null;
}

function checkText(text, file) {
  const failures = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const headerText = lines[i].trim();
    if (!HEADERS.has(headerText)) continue;
    if (i > 0 && SKIP_MARKER.test(lines[i - 1])) continue;

    const baseIndent = lines[i].length - lines[i].trimStart().length;
    const entries = [];
    let lastEntryIndent = null;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      // A backtick marks the end of the surrounding template literal. The
      // header sat inside one (help text always does), so once we see a
      // backtick we've exited the help text — anything past it is TS code
      // (entries like `if`, `switch`, `case` are false positives otherwise).
      if (next.includes('`')) break;
      if (!next.trim()) break;
      const indent = next.length - next.trimStart().length;
      if (indent <= baseIndent) break;
      // Continuation lines (deeper than the entry that started above) — skip.
      if (lastEntryIndent !== null && indent > lastEntryIndent) { j++; continue; }
      const key = entryKey(next);
      if (key) {
        entries.push({ key, line: j + 1 });
        lastEntryIndent = indent;
      }
      j++;
    }

    if (entries.length < 2) continue;
    const sorted = entries.slice().sort((a, b) => a.key.localeCompare(b.key));
    const ok = entries.every((e, idx) => e.key === sorted[idx].key);
    if (!ok) {
      failures.push({
        file,
        line: i + 1,
        header: headerText,
        got: entries.map(e => e.key).join(', '),
        expected: sorted.map(e => e.key).join(', '),
      });
    }
  }
  return failures;
}

const files = walkTs(SRC_DIR);
const failures = [];
for (const f of files) {
  failures.push(...checkText(fs.readFileSync(f, 'utf8'), path.relative(REPO_ROOT, f)));
}

if (failures.length === 0) {
  console.log(`✓ help-order lint passed — ${files.length} source files scanned`);
  process.exit(0);
}

console.log(`✗ help-order lint failed — ${failures.length} block(s) out of order:\n`);
for (const f of failures) {
  console.log(`  ${f.file}:${f.line}  ${f.header}`);
  console.log(`    got:      ${f.got}`);
  console.log(`    expected: ${f.expected}\n`);
}
console.log(`Fix: re-order the block alphabetically by the leading identifier,`);
console.log(`or add a "// lint:help-order skip — <reason>" comment on the line`);
console.log(`directly above the header if the order is intentional (e.g.`);
console.log(`lifecycle order you want to preserve).`);
process.exit(1);
