#!/usr/bin/env node
// Skill linter — validates structure + token budget across every SKILL.md
// in the bundled skills directory (or a custom dir via --dir=<path>).
//
// Two-tier check (per S-202a + S-202b in the integrations sprint plan):
//
//   HARD requirements (errors, exit 1):
//     - File exists and is readable
//     - Has parseable YAML frontmatter
//     - Frontmatter has `name` and `description`
//     - Body has at least one heading
//     - Token budget: <= MAX_CHARS chars (~MAX_CHARS/4 tokens)
//
//   TARGET structure (warnings, exit 0 unless --strict):
//     - Frontmatter `version` (set up by S-203)
//     - Frontmatter `triggers` array (S-202a target structure)
//     - Frontmatter `checksum` (S-203 self-update)
//     - Body sections `## Capabilities`, `## Commands`, `## Examples`
//     - Block delimiters paired (<!-- llm:start --> / <!-- llm:end -->,
//       <!-- generated:start --> / <!-- generated:end -->)
//
// The two-tier model exists because the existing bundled skills have
// minimal frontmatter and don't follow the S-208-target structure yet.
// CI runs in lenient mode today; flip to --strict once S-208 has rewritten
// the skills to the target shape.
//
// Token budget intentionally uses chars/4 approximation (NFR-005: no
// tokenizer dependency, even at dev time). Conservative bias: if you
// pass the chars/4 check you're definitely under the real-tokens budget.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');

// Default: lint the bundled skills (what gets shipped to users).
const DEFAULT_SKILLS_DIR = path.resolve(PKG_ROOT, 'src', 'skills');
const MAX_CHARS = 8000; // ~2000 tokens via chars/4 conservative approximation
const REQUIRED_FRONTMATTER = ['name', 'description'];
const TARGET_FRONTMATTER = ['version', 'triggers', 'checksum'];
const TARGET_SECTIONS = ['## Capabilities', '## Commands', '## Examples'];
const BLOCK_DELIMS = [
  ['<!-- llm:start -->', '<!-- llm:end -->'],
  ['<!-- generated:start -->', '<!-- generated:end -->'],
];

function parseArgs(argv) {
  const args = { dir: null, strict: false, json: false, help: false };
  for (const a of argv) {
    if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--dir=')) args.dir = a.slice('--dir='.length);
  }
  return args;
}

const HELP = `Usage: npm run lint:skills [-- --strict] [--json] [--dir=<path>]

Validates every SKILL.md in the bundled skills directory.

Options:
  --strict            Treat warnings as errors (exit non-zero on any warning)
  --json              Emit machine-readable JSON output
  --dir=<path>        Lint a custom skills directory (default: packages/cli/src/skills)
  --help, -h          Show this help

Token budget: <= ${MAX_CHARS} chars (~${MAX_CHARS / 4} tokens via chars/4 approximation)
`;

// Parse YAML frontmatter — minimal subset, deps-free. Handles:
//   - "key: value"
//   - "key: >\n  value\n"  (folded block scalar)
//   - "key: [a, b]"
//   - "key:\n  - a\n  - b\n" (block-list arrays)
function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(src);
  if (!m) return { frontmatter: null, body: src };
  const fmRaw = m[1];
  const body = m[2];
  const fm = {};

  const lines = fmRaw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) { i++; continue; }
    const key = kv[1];
    let value = kv[2];

    if (value === '>' || value === '|') {
      // Folded / literal block scalar — collect indented lines.
      const collected = [];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i])) {
        collected.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      fm[key] = collected.join(value === '>' ? ' ' : '\n').trim();
      continue;
    }

    if (value === '') {
      // Block-list array on next lines.
      const list = [];
      i++;
      while (i < lines.length && /^\s+-\s/.test(lines[i])) {
        list.push(lines[i].replace(/^\s+-\s/, '').trim());
        i++;
      }
      if (list.length > 0) {
        fm[key] = list;
      } else {
        fm[key] = '';
      }
      continue;
    }

    // Inline array: [a, b, c]
    const arr = /^\[(.*)\]$/.exec(value);
    if (arr) {
      fm[key] = arr[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      // Strip surrounding quotes
      fm[key] = value.replace(/^["']|["']$/g, '').trim();
    }
    i++;
  }

  return { frontmatter: fm, body };
}

function lintSkill(skillName, skillFile) {
  const errors = [];
  const warnings = [];

  let raw;
  try { raw = fs.readFileSync(skillFile, 'utf-8'); }
  catch (e) {
    errors.push(`could not read file: ${e.message}`);
    return { skill: skillName, file: skillFile, errors, warnings, charCount: 0 };
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  if (!frontmatter) {
    errors.push('missing or malformed YAML frontmatter (must start with "---" and close with "---")');
  } else {
    for (const k of REQUIRED_FRONTMATTER) {
      if (!frontmatter[k] || (typeof frontmatter[k] === 'string' && frontmatter[k].length === 0)) {
        errors.push(`frontmatter missing required field: ${k}`);
      }
    }
    for (const k of TARGET_FRONTMATTER) {
      if (frontmatter[k] === undefined) {
        warnings.push(`frontmatter missing target field: ${k} (planned in S-203 / S-208)`);
      }
    }
    if (frontmatter.triggers !== undefined && !Array.isArray(frontmatter.triggers)) {
      warnings.push(`frontmatter "triggers" should be an array (got ${typeof frontmatter.triggers})`);
    }
  }

  // Body must contain at least one heading
  if (!/^#+ \S/m.test(body)) {
    errors.push('body has no headings — must contain at least one "# Heading" line');
  }

  // Target body sections
  for (const section of TARGET_SECTIONS) {
    if (!body.includes(section)) {
      warnings.push(`body missing target section: ${section} (planned in S-208)`);
    }
  }

  // Block delimiters paired
  for (const [open, close] of BLOCK_DELIMS) {
    const opens = (body.match(new RegExp(escapeRe(open), 'g')) || []).length;
    const closes = (body.match(new RegExp(escapeRe(close), 'g')) || []).length;
    if (opens !== closes) {
      errors.push(`block delimiters unbalanced: ${open} (${opens}) vs ${close} (${closes})`);
    }
  }

  // Token budget — chars/4 conservative approximation
  const charCount = body.length;
  if (charCount > MAX_CHARS) {
    const est = Math.ceil(charCount / 4);
    errors.push(`token budget exceeded: body is ${charCount} chars (~${est} tokens), max ${MAX_CHARS} chars (~${MAX_CHARS / 4} tokens)`);
  }

  return { skill: skillName, file: skillFile, errors, warnings, charCount };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function discoverSkills(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Skills directory not found: ${dir}`);
  }
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(dir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      found.push({ name: entry.name, file: skillFile });
    }
  }
  return found;
}

function printJson(results, totals) {
  console.log(JSON.stringify({ totals, results }, null, 2));
}

function printText(results, totals, args) {
  console.log(`Skills lint — ${totals.skills} skills, ${totals.errors} errors, ${totals.warnings} warnings`);
  console.log('');

  for (const r of results) {
    const status = r.errors.length > 0 ? '✗' : (r.warnings.length > 0 ? '⚠' : '✓');
    const headline = `${status} ${r.skill}  (body: ${r.charCount} chars, ~${Math.ceil(r.charCount / 4)} tokens)`;
    console.log(headline);
    for (const e of r.errors) console.log(`    ✗ ${e}`);
    if (args.strict) {
      for (const w of r.warnings) console.log(`    ✗ [warn-as-error] ${w}`);
    } else {
      for (const w of r.warnings) console.log(`    ⚠ ${w}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); process.exit(0); }
  const dir = args.dir ? path.resolve(process.cwd(), args.dir) : DEFAULT_SKILLS_DIR;

  let skills;
  try { skills = discoverSkills(dir); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }

  if (skills.length === 0) {
    console.error(`✗ No SKILL.md files found in ${dir}`);
    process.exit(2);
  }

  const results = skills.map(s => lintSkill(s.name, s.file));
  const errors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const warnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  const totals = { skills: skills.length, errors, warnings, charBudget: MAX_CHARS };

  if (args.json) printJson(results, totals);
  else printText(results, totals, args);

  // Exit code:
  //   0  no hard errors (warnings tolerated unless --strict)
  //   1  at least one hard error, OR --strict and any warning
  const hardFail = errors > 0 || (args.strict && warnings > 0);
  process.exit(hardFail ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
  });
}

export {
  parseArgs,
  parseFrontmatter,
  lintSkill,
  discoverSkills,
  MAX_CHARS,
  REQUIRED_FRONTMATTER,
  TARGET_FRONTMATTER,
  TARGET_SECTIONS,
  BLOCK_DELIMS,
};
