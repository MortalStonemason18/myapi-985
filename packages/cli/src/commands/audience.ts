import { audience as sdkAudience } from '@myapihq/sdk';
import { requireConfig } from '../config.js';
import { success, error, printTable, info, printJson } from '../output.js';
import type { FlagSchema } from '../flags.js';
import { type Flags, requireOrg, requireArg } from '../helpers.js';
import type { Exposes } from '../exposes.js';

export const EXPOSES: Exposes = [
  'POST /audience/orgs/{org_id}/audiences',
  'GET /audience/orgs/{org_id}/audiences',
  'GET /audience/orgs/{org_id}/audiences/{audience_id}',
  'PATCH /audience/orgs/{org_id}/audiences/{audience_id}',
  'DELETE /audience/orgs/{org_id}/audiences/{audience_id}',
  'GET /audience/orgs/{org_id}/audiences/{audience_id}/members',
  'POST /audience/orgs/{org_id}/audiences/{audience_id}/refresh',
];

export const SCHEMA: FlagSchema = {
  org: 'string',
  name: 'string',
  description: 'string',
  source: 'string',
  filter: 'string',
  limit: 'number',
  offset: 'number',
};

function parseFilter(raw: unknown): sdkAudience.SearchFilter {
  if (typeof raw !== 'string' || raw.trim() === '') {
    error('Missing --filter. Pass a JSON object, e.g.\n  --filter \'{"industry":["saas"],"seniority":["vp","c_level"]}\'');
  }
  try {
    const parsed = JSON.parse(raw as string);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      error('--filter must be a JSON object (e.g. {"industry":["saas"]}).');
    }
    return parsed as sdkAudience.SearchFilter;
  } catch (e: any) {
    error(`--filter is not valid JSON: ${e?.message ?? e}`);
    throw e; // unreachable; error() exits
  }
}

function summarizeAudience(a: sdkAudience.Audience) {
  return {
    id: a.id,
    name: a.name,
    source: a.source,
    members: a.member_count,
    created_at: a.created_at,
  };
}

async function create(nameArg: string | undefined, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience create <name> --source <people|company> --filter <json>');
  const name = nameArg || (flags.name as string);
  if (!name) error('Missing required argument <name>.\nUsage: myapi audience create <name> --source <people|company> --filter <json>');
  const source = flags.source as string;
  if (source !== 'people' && source !== 'company') {
    error(`--source must be "people" or "company" (got: ${source ?? '<missing>'}).`);
  }
  const filter = parseFilter(flags.filter);
  const description = typeof flags.description === 'string' ? flags.description : undefined;

  const res = await sdkAudience.createAudience(config.api_key, orgId, {
    name, source: source as sdkAudience.AudienceSource, filter, description,
  });
  if (flags.json) { printJson(res); return; }
  success(`Audience created! ID: ${res.id}\nMembers: ${res.member_count}\nSource: ${res.source}`);
}

async function list(flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience list [--org <id>]');
  const res = await sdkAudience.listAudiences(config.api_key, orgId);
  if (flags.json) { printJson(res); return; }
  printTable(res.map(summarizeAudience), {
    flags,
    empty: 'No audiences yet. Create one with: myapi audience create <name> --source <people|company> --filter <json>',
  });
}

async function get(id: string, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience get <id> [--org <id>]');
  requireArg(id, 'id', 'myapi audience get <id> [--org <id>]');
  const res = await sdkAudience.getAudience(config.api_key, orgId, id);
  printJson(res);
}

async function update(id: string, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience update <id> [--name x] [--description y] [--filter <json>]');
  requireArg(id, 'id', 'myapi audience update <id> [--name x] [--description y] [--filter <json>]');
  const patch: sdkAudience.UpdateAudienceInput = {};
  if (typeof flags.name === 'string') patch.name = flags.name;
  if (typeof flags.description === 'string') patch.description = flags.description;
  if (typeof flags.filter === 'string') patch.filter = parseFilter(flags.filter);
  if (Object.keys(patch).length === 0) {
    error('Pass at least one of --name / --description / --filter to update.');
  }
  const res = await sdkAudience.updateAudience(config.api_key, orgId, id, patch);
  if (flags.json) { printJson(res); return; }
  success(`Audience ${res.id} updated. Members: ${res.member_count}`);
}

async function del(id: string, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience delete <id> [--org <id>]');
  requireArg(id, 'id', 'myapi audience delete <id> [--org <id>]');
  await sdkAudience.deleteAudience(config.api_key, orgId, id);
  success(`Audience ${id} deleted`);
}

async function members(id: string, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience members <id> [--limit N] [--offset N] [--org <id>]');
  requireArg(id, 'id', 'myapi audience members <id> [--limit N] [--offset N] [--org <id>]');
  const opts: { limit?: number; offset?: number } = {};
  if (typeof flags.limit === 'number') opts.limit = flags.limit;
  if (typeof flags.offset === 'number') opts.offset = flags.offset;
  const res = await sdkAudience.getAudienceMembers(config.api_key, orgId, id, opts);
  if (flags.json) { printJson(res); return; }
  // Response doesn't carry `source` — detect by which array is present.
  const isPeople = Array.isArray(res.people);
  const kind = isPeople ? 'people' : 'companies';
  const count = isPeople ? (res.people?.length ?? 0) : (res.companies?.length ?? 0);
  info(`${count} of ${res.total} ${kind}${res.has_more ? ' (more available — pass --offset)' : ''}`);
  if (isPeople) {
    printTable((res.people ?? []).map(p => ({
      id: p.id,
      name: p.full_name,
      email: p.email ?? '',
      domain: p.company?.domain ?? '',
      country: p.location?.country ?? '',
      link_conf: typeof p.link_confidence === 'number' ? p.link_confidence.toFixed(2) : '',
    })), { flags, empty: 'Audience has no members.' });
  } else {
    printTable((res.companies ?? []).map(c => ({
      id: c.id,
      domain: c.domain ?? '',
      name: c.name,
      country: c.country ?? '',
      confidence: c.confidence ?? '',
      headcount: c.headcount_lower_bound ?? '',
      sources: c.source_count ?? '',
    })), { flags, empty: 'Audience has no members.' });
  }
}

async function refresh(id: string, flags: Flags) {
  const config = requireConfig();
  const orgId = requireOrg(flags, config, 'myapi audience refresh <id> [--org <id>]');
  requireArg(id, 'id', 'myapi audience refresh <id> [--org <id>]');
  const res = await sdkAudience.refreshAudience(config.api_key, orgId, id);
  if (flags.json) { printJson(res); return; }
  const sign = res.delta > 0 ? '+' : '';
  success(`Refreshed. ${res.previous} → ${res.total} (${sign}${res.delta})`);
}

const SUBCOMMAND_USAGE: Record<string, string> = {
  'create':  `myapi audience create <name> --source <people|company> --filter <json> [--description <text>] [--org <id>]

The Goldfox filter shape is shared across people/company/audience:
  {
    "confidence": ["high"],                    // high (default), low, very_low
    "country": ["US", "DE"],                   // ISO 3166-1 alpha-2
    "country_consistent": true,                // TLD+address+phone all agree
    "seniority": ["c_level", "vp_director"],   // people-source only
    "email_type": ["corporate"],               // people-source only
    "tld_class": ["cctld"],                    // cctld/generic/vanity/low_trust/other
    "has_c_level": true,                       // boolean signals
    "has_decision_maker": true,
    "has_careers_page": true,
    "has_investors_page": false,
    "has_shop_page": false,
    "is_registered_entity": true,              // recognised legal suffix
    "min_headcount": 5,
    "min_source_count": 3,
    "min_link_confidence": 0.8,                // people-source only
    "keyword": "platform",                     // substring match on domain
    "limit": 100,
    "offset": 0
  }
Within an array → OR. Across fields → AND. Empty filter = all rows in
source with default confidence=high (Goldfox's curated tier).

Example:
  myapi audience create "EU decision makers" \\
    --source people \\
    --filter '{"seniority":["c_level","vp_director"],"country":["DE","FR","GB"],"email_type":["corporate"]}'`,
  'list':    'myapi audience list [--org <id>] [--json]',
  'get':     'myapi audience get <id> [--org <id>]',
  'update':  'myapi audience update <id> [--name <x>] [--description <y>] [--filter <json>] [--org <id>]',
  'delete':  'myapi audience delete <id> [--org <id>]',
  'members': 'myapi audience members <id> [--limit N] [--offset N] [--org <id>] [--json]',
  'refresh': 'myapi audience refresh <id> [--org <id>]',
};

export async function run(subcommand: string | undefined, args: string[], flags: Flags) {
  if (!subcommand || (flags.help && !subcommand)) {
    info(`Usage: myapi audience <subcommand>

Subcommands:
  create     Save a filter as a named audience (people or company source)
  delete     Remove an audience
  get        Get a single audience (with its filter + current member_count)
  list       List all audiences in the org
  members    Get paged member snapshot (people or companies depending on source)
  refresh    Re-evaluate filter against current data; returns delta vs previous
  update     Patch name / description / filter (re-evaluates count if filter changes)

All commands accept --org <id> (or set a default: myapi config set-org <id>).

Audiences are saved filter snapshots. Same filter shape as myapi people search /
company search — see "myapi audience create --help" for the schema.`);
    return;
  }
  if (flags.help) {
    const usage = SUBCOMMAND_USAGE[subcommand];
    if (usage) info(`Usage: ${usage}`);
    else info(`Unknown subcommand: ${subcommand}. Run "myapi audience --help" for the list.`);
    return;
  }
  switch (subcommand) {
    case 'create':  return create(args[0], flags);
    case 'list':    return list(flags);
    case 'get':     return get(args[0], flags);
    case 'update':  return update(args[0], flags);
    case 'delete':  return del(args[0], flags);
    case 'members': return members(args[0], flags);
    case 'refresh': return refresh(args[0], flags);
    default: error(`Unknown subcommand: ${subcommand}. Run "myapi audience --help" for valid subcommands.`);
  }
}
