#!/usr/bin/env node
// Coverage check tool — verifies every endpoint in the OpenAPI schema
// is reachable via at least one CLI command (per its declared EXPOSES array).
//
// Usage:
//   npm run check-coverage                     ← uses schema-snapshot.json
//   npm run check-coverage -- --live           ← fetches live schema
//   npm run check-coverage -- --schema=<path>  ← uses a custom schema file
//   npm run check-coverage -- --json           ← machine-readable output
//   npm run check-coverage -- --output=<path>  ← also write markdown to file
//
// Exit codes:
//   0  all schema endpoints covered (or only allowlisted gaps)
//   1  one or more uncovered endpoints found
//   2  setup error (missing schema, malformed input, etc.)

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PKG_ROOT = path.resolve(__dirname, '..');
const COMMANDS_DIST = path.resolve(PKG_ROOT, 'dist', 'commands');
const SNAPSHOT_PATH = path.resolve(PKG_ROOT, 'schema-snapshot.json');
const ALLOWLIST_PATH = path.resolve(PKG_ROOT, 'coverage-allowlist.json');
const LIVE_URL = 'https://api.myapihq.com/schema/v1/openapi.json';

// SDK service surface — checked for parity per FR-005 / S-108. The SDK is
// the foundation; the CLI calls it. SDK should have the most complete
// coverage of the schema. SDK gaps are non-blocking (Should-have priority).
const SDK_DIST = path.resolve(PKG_ROOT, '..', 'sdk', 'dist');
// Files in dist that aren't service modules (no EXPOSES expected on these).
const SDK_NON_SERVICE_FILES = new Set(['client.js', 'config.js', 'index.js', 'types.js', 'exposes.js']);

// Methods we consider — matches what's allowed by the Endpoint type in src/exposes.ts.
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function parseArgs(argv) {
  const args = { live: false, schema: null, json: false, output: null, help: false };
  for (const a of argv) {
    if (a === '--live') args.live = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--schema=')) args.schema = a.slice('--schema='.length);
    else if (a.startsWith('--output=')) args.output = a.slice('--output='.length);
    else if (!a.startsWith('-')) {
      // ignore positional
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const HELP = `Usage: npm run check-coverage [-- --live | --schema=<path>] [--json] [--output=<path>]

Compares the OpenAPI schema to the EXPOSES arrays declared by every CLI
command module. Exits non-zero if any schema endpoint is uncovered (after
applying coverage-allowlist.json).

Options:
  --live              Fetch schema from ${LIVE_URL}
  --schema=<path>     Read schema from a custom JSON file
  (default)           Read schema from packages/cli/schema-snapshot.json
  --json              Emit machine-readable JSON instead of a markdown report
  --output=<path>     Also write the markdown report to <path> (e.g. coverage-report.md)
  --help, -h          Show this help

Files:
  schema-snapshot.json        Committed snapshot. Refresh via: npm run update-schema
  coverage-allowlist.json     Endpoints intentionally not covered (with reason)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Schema loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadSchema(args) {
  if (args.schema) {
    return readJsonOrFail(args.schema, `--schema=${args.schema}`);
  }
  if (args.live) {
    return await fetchSchema(LIVE_URL);
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    fail(2,
      `Schema snapshot not found at ${path.relative(process.cwd(), SNAPSHOT_PATH)}.\n` +
      `  Once the backend ships GET /schema/v1/openapi.json (S-104), run:\n` +
      `    npm run update-schema\n` +
      `  Or for a one-off check, use --live or --schema=<path>.`);
  }
  return readJsonOrFail(SNAPSHOT_PATH, 'snapshot');
}

function readJsonOrFail(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); }
  catch (e) { fail(2, `Could not read ${label} (${file}): ${e.message}`); }
  try { return JSON.parse(raw); }
  catch (e) { fail(2, `${label} is not valid JSON: ${e.message}`); }
}

function fetchSchema(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000 }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect.
        res.resume();
        return resolve(fetchSchema(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`fetch ${url}: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { reject(new Error(`fetch ${url}: invalid JSON: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error(`fetch ${url}: timeout`)); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint extraction + normalization
// ─────────────────────────────────────────────────────────────────────────────

// Replace every {paramName} with {*} so paths match regardless of parameter
// naming. This is intentional — the backend names params however it wants;
// the integrations side names them however it wants; matching is structural.
function normalize(p) {
  return p.replace(/\{[^}]+\}/g, '{*}');
}

function key(method, p) {
  return `${method.toUpperCase()} ${normalize(p)}`;
}

function parseEndpoint(s) {
  const m = /^([A-Z]+)\s+(\/.+)$/.exec(s);
  if (!m) throw new Error(`Malformed endpoint declaration: "${s}"`);
  const method = m[1];
  if (!HTTP_METHODS.includes(method.toLowerCase())) {
    throw new Error(`Unsupported HTTP method "${method}" in endpoint "${s}"`);
  }
  return { method, path: m[2] };
}

function extractSchemaEndpoints(schema) {
  if (!schema || typeof schema.paths !== 'object' || schema.paths === null) {
    throw new Error(`Schema does not contain a "paths" object — is this a valid OpenAPI document?`);
  }
  const out = [];
  for (const [pathStr, pathItem] of Object.entries(schema.paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      if (pathItem[method] && typeof pathItem[method] === 'object') {
        // Honor the OpenAPI `deprecated` flag — deprecated endpoints don't
        // need coverage. They'll be removed in the next major.
        if (pathItem[method].deprecated === true) continue;
        out.push({ method: method.toUpperCase(), path: pathStr });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPOSES collection
// ─────────────────────────────────────────────────────────────────────────────

function walkJsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsFiles(p));
    // Skip compiled test files — they carry no EXPOSES and importing them
    // outside a vitest runner throws (their top-level describe() calls).
    else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      out.push(p);
    }
  }
  return out;
}

async function collectExposes(commandsDir) {
  return collectExposesFrom(commandsDir, /* requireExposes */ true);
}

// Parameterized collector. When `requireExposes` is true, every walked file
// must export an EXPOSES array (or we throw). When false, files without
// EXPOSES are tolerated and flagged in the warnings list — kept for the SDK
// path which tolerates non-service files gracefully.
async function collectExposesFrom(dir, requireExposes) {
  if (!fs.existsSync(dir)) {
    throw new Error(
      `Module directory not found at ${path.relative(process.cwd(), dir)}.\n` +
      `  Run "npm run build" first — this tool reads compiled modules from dist/.`);
  }
  const collected = [];
  const warnings = [];
  for (const file of walkJsFiles(dir)) {
    const fileUrl = pathToFileURL(file).href;
    const mod = await import(fileUrl);
    if (!Array.isArray(mod.EXPOSES)) {
      const rel = path.relative(path.resolve(PKG_ROOT, '..'), file);
      if (requireExposes) {
        throw new Error(`${rel} does not export an EXPOSES array. See packages/cli/src/exposes.ts.`);
      }
      warnings.push(`${rel} has no EXPOSES export — treated as covering zero endpoints.`);
      continue;
    }
    const endpoints = mod.EXPOSES.map(parseEndpoint);
    collected.push({
      source: path.relative(path.resolve(PKG_ROOT, '..'), file),
      endpoints,
    });
  }
  return { collected, warnings };
}

// Walk the SDK's compiled service modules. Each file at packages/sdk/dist/*.js
// is treated as a service module unless it's in SDK_NON_SERVICE_FILES.
async function collectSdkExposes() {
  if (!fs.existsSync(SDK_DIST)) return null;
  const collected = [];
  const warnings = [];
  for (const entry of fs.readdirSync(SDK_DIST, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    if (SDK_NON_SERVICE_FILES.has(entry.name)) continue;
    const file = path.join(SDK_DIST, entry.name);
    const fileUrl = pathToFileURL(file).href;
    const mod = await import(fileUrl);
    if (!Array.isArray(mod.EXPOSES)) {
      warnings.push(`packages/sdk/dist/${entry.name} has no EXPOSES export`);
      continue;
    }
    const endpoints = mod.EXPOSES.map(parseEndpoint);
    collected.push({
      source: path.relative(path.resolve(PKG_ROOT, '..'), file),
      endpoints,
    });
  }
  return { collected, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Allowlist
// ─────────────────────────────────────────────────────────────────────────────

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { entries: [], byKey: new Map() };
  }
  const data = readJsonOrFail(ALLOWLIST_PATH, 'allowlist');
  const entries = Array.isArray(data.deferred) ? data.deferred : [];
  const byKey = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.endpoint !== 'string' || typeof entry.reason !== 'string') {
      throw new Error(`Allowlist entry malformed (need {endpoint, reason}): ${JSON.stringify(entry)}`);
    }
    const ep = parseEndpoint(entry.endpoint);
    byKey.set(key(ep.method, ep.path), { endpoint: ep, reason: entry.reason });
  }
  return { entries, byKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reporting
// ─────────────────────────────────────────────────────────────────────────────

function buildReport({ schemaEndpoints, collected, allowlist, sdk = null }) {
  const cli = computeCoverage(schemaEndpoints, collected, allowlist);

  // SDK parity — separate, non-blocking diff. SDK is the foundation; gaps
  // here mean a backend endpoint isn't reachable through any client surface,
  // which is a deeper problem than CLI-only gaps.
  let sdkReport = null;
  if (sdk) {
    const sdkCovered = computeCoverage(schemaEndpoints, sdk.collected, { byKey: new Map() });
    sdkReport = {
      coveredCount: sdkCovered.covered.length,
      gaps: sdkCovered.gaps,
      warnings: sdk.warnings,
      moduleCount: sdk.collected.length,
    };
  }

  return {
    total: schemaEndpoints.length,
    covered: cli.covered,
    deferred: cli.deferred,
    gaps: cli.gaps,
    sourceCount: collected.length,
    sourceFiles: collected.map(c => c.source),
    sdk: sdkReport,
  };
}

function computeCoverage(schemaEndpoints, collected, allowlist) {
  const coveredKeys = new Set();
  const coveredBy = new Map();
  for (const c of collected) {
    for (const ep of c.endpoints) {
      const k = key(ep.method, ep.path);
      coveredKeys.add(k);
      if (!coveredBy.has(k)) coveredBy.set(k, []);
      coveredBy.get(k).push(c.source);
    }
  }
  const covered = [];
  const deferred = [];
  const gaps = [];
  for (const ep of schemaEndpoints) {
    const k = key(ep.method, ep.path);
    if (coveredKeys.has(k)) {
      covered.push({ ...ep, sources: coveredBy.get(k) });
    } else if (allowlist.byKey.has(k)) {
      deferred.push({ ...ep, reason: allowlist.byKey.get(k).reason });
    } else {
      gaps.push(ep);
    }
  }
  return { covered, deferred, gaps };
}

function printJson(report) {
  const out = {
    total: report.total,
    covered_count: report.covered.length,
    deferred_count: report.deferred.length,
    gap_count: report.gaps.length,
    coverage_percent: report.total === 0 ? 100 : Math.round((report.covered.length / report.total) * 1000) / 10,
    gaps: report.gaps,
    deferred: report.deferred,
  };
  if (report.sdk) {
    out.sdk = {
      covered_count: report.sdk.coveredCount,
      gap_count: report.sdk.gaps.length,
      module_count: report.sdk.moduleCount,
      gaps: report.sdk.gaps,
      warnings: report.sdk.warnings,
    };
  }
  console.log(JSON.stringify(out, null, 2));
}

// Renders the markdown report as a single string. Used both for stdout and
// for --output=<path> file writing so the two paths can never drift.
function renderMarkdown(report) {
  const pct = report.total === 0 ? '100.0' : ((report.covered.length / report.total) * 100).toFixed(1);
  const status = report.gaps.length === 0 ? '✓ PASS' : '✗ FAIL';

  const lines = [];
  lines.push(`# Coverage Report`);
  lines.push('');
  lines.push(`**${status}** — ${report.covered.length}/${report.total} endpoints covered (${pct}%)`);
  lines.push(`Source modules walked: ${report.sourceCount}`);
  lines.push(`Deferred (allowlisted): ${report.deferred.length}`);
  lines.push(`Gaps (uncovered): ${report.gaps.length}`);
  lines.push('');

  if (report.gaps.length > 0) {
    lines.push('## Uncovered endpoints');
    lines.push('');
    for (const ep of report.gaps) {
      lines.push(`- \`${ep.method} ${ep.path}\``);
    }
    lines.push('');
  }

  if (report.deferred.length > 0) {
    lines.push('## Deferred (allowlisted)');
    lines.push('');
    for (const ep of report.deferred) {
      lines.push(`- \`${ep.method} ${ep.path}\` — ${ep.reason}`);
    }
    lines.push('');
  }

  // SDK parity — informational, never gates CI.
  if (report.sdk) {
    const sdkPct = report.total === 0
      ? '100.0'
      : ((report.sdk.coveredCount / report.total) * 100).toFixed(1);
    lines.push('## SDK Parity *(informational, non-blocking)*');
    lines.push('');
    lines.push(`${report.sdk.coveredCount}/${report.total} schema endpoints reachable via SDK functions (${sdkPct}%).`);
    lines.push(`SDK service modules walked: ${report.sdk.moduleCount}`);
    lines.push('');
    if (report.sdk.gaps.length > 0) {
      lines.push('### Endpoints in schema but not in any SDK module');
      lines.push('');
      for (const ep of report.sdk.gaps) {
        lines.push(`- \`${ep.method} ${ep.path}\``);
      }
      lines.push('');
    }
    if (report.sdk.warnings.length > 0) {
      lines.push('### SDK warnings');
      lines.push('');
      for (const w of report.sdk.warnings) {
        lines.push(`- ${w}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function printMarkdown(report) {
  console.log(renderMarkdown(report));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

function fail(code, msg) {
  console.error(`✗ ${msg}`);
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  let schema;
  try { schema = await loadSchema(args); }
  catch (e) { fail(2, `Failed to load schema: ${e.message}`); }

  let schemaEndpoints;
  try { schemaEndpoints = extractSchemaEndpoints(schema); }
  catch (e) { fail(2, e.message); }

  let collected;
  try {
    const result = await collectExposesFrom(COMMANDS_DIST, /* requireExposes */ true);
    collected = result.collected;
  } catch (e) { fail(2, e.message); }

  // Best-effort: walk SDK if its dist exists. Don't fail if it doesn't.
  let sdk = null;
  try { sdk = await collectSdkExposes(); }
  catch (e) { /* swallow — SDK is non-blocking */ }

  const allowlist = loadAllowlist();
  const report = buildReport({ schemaEndpoints, collected, allowlist, sdk });

  if (args.json) printJson(report);
  else printMarkdown(report);

  if (args.output) {
    const md = renderMarkdown(report);
    const outPath = path.resolve(process.cwd(), args.output);
    fs.writeFileSync(outPath, md + '\n', 'utf-8');
  }

  process.exit(report.gaps.length === 0 ? 0 : 1);
}

// Allow this script to be imported (for testing) without auto-running.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
  });
}

// Exports for unit testing.
export {
  parseArgs,
  parseEndpoint,
  normalize,
  key,
  extractSchemaEndpoints,
  loadAllowlist,
  buildReport,
  collectExposes,
  collectExposesFrom,
  collectSdkExposes,
  computeCoverage,
  renderMarkdown,
};
