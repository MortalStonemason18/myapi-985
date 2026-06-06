#!/usr/bin/env node
// Fetches the live OpenAPI schema and writes it to schema-snapshot.json.
// Run after the backend ships an updated schema; commit the resulting
// snapshot file so CI uses a reproducible reference.
//
// Usage:
//   npm run update-schema                              ← fetch from default URL
//   MYAPI_SCHEMA_URL=http://localhost:8080/... \
//     npm run update-schema                            ← fetch from custom URL
//   npm run update-schema -- --url=<url>               ← one-off URL override
//
// Environment:
//   MYAPI_SCHEMA_URL — overrides the default URL (matches the SDK's pattern
//                      of MYAPI_*_URL env vars for local-dev redirection).
//
// Exit codes:
//   0  snapshot updated (or unchanged)
//   1  fetch failed / response invalid

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.resolve(PKG_ROOT, 'schema-snapshot.json');

const DEFAULT_URL = 'https://api.myapihq.com/schema/v1/openapi.json';

function parseArgs(argv) {
  const args = { url: null, help: false };
  for (const a of argv) {
    if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--url=')) args.url = a.slice('--url='.length);
  }
  return args;
}

function resolveUrl(args) {
  if (args.url) return args.url;
  if (process.env.MYAPI_SCHEMA_URL) return process.env.MYAPI_SCHEMA_URL;
  return DEFAULT_URL;
}

function fetchSchema(targetUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(targetUrl, { timeout: 15_000 }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchSchema(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`fetch ${targetUrl}: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try {
          const parsed = JSON.parse(body);
          resolve({ raw: body, parsed });
        } catch (e) {
          reject(new Error(`fetch ${targetUrl}: invalid JSON: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`fetch ${targetUrl}: timeout`)));
  });
}

const HELP = `Usage: npm run update-schema [-- --url=<url>]

Fetches the OpenAPI schema from the backend and writes it to
packages/cli/schema-snapshot.json. Commit the resulting file so CI uses
a reproducible reference.

Options:
  --url=<url>         Fetch from this URL (overrides default + env var)
  --help, -h          Show this help

Environment:
  MYAPI_SCHEMA_URL    Default URL override (e.g. for local backend dev)

Default URL: ${DEFAULT_URL}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  const url = resolveUrl(args);

  console.log(`› Fetching schema from ${url} ...`);
  let result;
  try { result = await fetchSchema(url); }
  catch (e) {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }

  // Light sanity check: does it look like an OpenAPI doc?
  if (!result.parsed || typeof result.parsed.paths !== 'object') {
    console.error(`✗ Response from ${url} is not a valid OpenAPI document (no "paths" object).`);
    process.exit(1);
  }

  const pathCount = Object.keys(result.parsed.paths).length;
  const methodCount = Object.values(result.parsed.paths).reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    return sum + ['get', 'post', 'put', 'patch', 'delete'].filter(m => item[m]).length;
  }, 0);
  const version = result.parsed.info && result.parsed.info.version ? result.parsed.info.version : '(no version)';

  // Detect changes vs the existing snapshot — useful for "did I really need
  // to commit this?" decisions.
  let prior = null;
  if (fs.existsSync(SNAPSHOT_PATH)) {
    try {
      prior = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'));
    } catch {}
  }
  const changed = !prior || JSON.stringify(prior) !== JSON.stringify(result.parsed);

  // Write pretty-printed JSON so diffs are reviewable when committed.
  const pretty = JSON.stringify(result.parsed, null, 2) + '\n';
  fs.writeFileSync(SNAPSHOT_PATH, pretty, 'utf-8');

  console.log(`✓ Wrote ${path.relative(process.cwd(), SNAPSHOT_PATH)}`);
  console.log(`  Schema version: ${version}`);
  console.log(`  Paths: ${pathCount}, method+path pairs: ${methodCount}`);
  if (changed) {
    console.log(`  Status: schema content changed — review the diff and commit.`);
  } else {
    console.log(`  Status: identical to existing snapshot — no commit needed.`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch(err => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

export {
  parseArgs,
  resolveUrl,
  fetchSchema,
};
