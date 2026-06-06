import { loadConfig, saveConfig, addAccount, switchAccount, listAccounts, requireConfig } from '../config.js';
import { info, success, error, printJson } from '../output.js';
import { ask, confirm, withReadline } from '../prompt.js';
import { installSkills } from './setup.js';
import { hq } from '@myapihq/sdk';
import { promptAndSave as promptAndSaveRegistrant } from '../registrant.js';
import type { FlagSchema } from '../flags.js';
import type { Flags } from '../helpers.js';
import type { Exposes } from '../exposes.js';

export const EXPOSES: Exposes = [
  'PATCH /hq/account/upgrade',
  'POST /hq/account/send-code',
  'POST /hq/account/verify-code',
  'GET /hq/billing/balance',
  'GET /hq/account/free-tier',
];

export const SCHEMA: FlagSchema = {
  'install-skills': 'boolean',
  'no-skills': 'boolean',
  anonymous: 'boolean',
  anon: 'boolean',
};

export const HELP = `Usage: myapi auth <subcommand>

Subcommands:
  api-keys        Manage API keys · list / create / revoke
  config          Manage CLI defaults (org, funnel, domain) · supports set-org / set-funnel / set-domain
  import-key      Import an existing API key non-interactively
  install-skills  DEPRECATED — use \`myapi install-skills\` instead
  keys            Alias for api-keys
  link [email]    Upgrade anonymous account to registered (or add a second session)
                  Use myapi auth setup to create a completely new account
  registrant      Manage stored WHOIS contact info for domain registration · set / get / clear
  setup           Configure your account
  switch [index]  Switch active account by index or email
  whoami          Show current account · supports --json`;

export const INSTALL_SKILLS_HELP = `Usage: myapi install-skills

Installs the MyAPI skills pack for AI coding agents (Claude, Gemini, Cursor).

This command writes skill definition files to:
  ~/.agents/skills/myapi/

And creates symlinks in the appropriate agent config directories:
  ~/.claude/  (Claude)
  ~/.gemini/  (Gemini)
  ~/.cursor/  (Cursor, if detected)

These files teach agents how to use the MyAPI CLI and API directly.
Run this command again to update existing skills to the latest version.

Note: \`myapi auth install-skills\` is deprecated and will be removed in the next minor.
Use \`myapi install-skills\` going forward.`;

const LINK_HELP = `Usage: myapi auth link [email]

Behavior depends on whether the email is new or already registered:

  New email:        Attaches it to your current anonymous account, upgrading it
                    to a registered account. A one-time code is sent to confirm.

  Existing email:   Does NOT merge accounts. The existing account is added as a
                    second active session — your anonymous account stays separate.
                    Switch between sessions with: myapi auth switch

To create a completely new account from scratch, use: myapi auth setup`;

const WHOAMI_HELP = `Usage: myapi auth whoami [--json]

Displays the active account details: email, account ID, default org,
default funnel, account type, and current balance.

Flags:
  --json   Output raw JSON`;

const SWITCH_HELP = `Usage: myapi auth switch [index|email]

Switches the active account. Run without arguments to see a numbered list
of accounts and choose interactively.

Pass an index number or email address to switch non-interactively:
  myapi auth switch 2
  myapi auth switch you@example.com

Note: index numbers can shift as accounts are added or removed.
Use email as a stable identifier in scripts.`;

// Resolve the user's "install skills?" preference: explicit flag wins, else prompt.
async function resolveSkillsPreference(flags: Flags): Promise<boolean> {
  if (flags['install-skills']) return true;
  if (flags['no-skills']) return false;
  return confirm('› Install the MyAPI skills pack? (Y/n) ', true);
}

// myapi auth link — upgrade anonymous session to registered account.
export async function link(flags: Flags = {}, emailArg?: string) {
  if (flags.help) { info(LINK_HELP); return; }
  const config = loadConfig();
  if (!config?.api_key) error('Not configured. Run: myapi auth setup');
  if (!config!.is_anonymous) error('Already registered. Use your existing account.');

  await withReadline(async () => {
    const email = emailArg || await ask('› Email? ');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error(`Invalid email address: "${email}".`);

    let upgradeOk = true;
    try {
      await hq.upgradeAccount(config!.api_key, email);
    } catch (err: any) {
      if (err.message !== 'EMAIL_TAKEN') throw err;
      upgradeOk = false;
      info(`› That email already has an account — accounts cannot be merged.`);
      info(`› Your anonymous account will be kept and you can switch back to it anytime.`);
      if (!await confirm('› Sign in and add it as a second account? (Y/n) ', true)) return;
      await hq.sendCode(email);
    }

    info(`› Sent a code to ${email} · paste it below`);

    const code = await ask('› Code? ');
    const data = await hq.verifyCode(email, code);

    const wantsSkills = await resolveSkillsPreference(flags);

    if (upgradeOk) {
      saveConfig({
        ...config!,
        api_key: data.api_key,
        account_id: data.account_id,
        email,
        default_org: data.default_org || config!.default_org,
        default_funnel: data.default_funnel || config!.default_funnel,
        is_anonymous: false,
        skills_installed: wantsSkills,
      });
      success(`› Welcome! Account upgraded · ${email}`);
    } else {
      const idx = addAccount({
        api_key: data.api_key,
        account_id: data.account_id,
        email,
        default_org: data.default_org,
        default_funnel: data.default_funnel,
        is_anonymous: false,
        skills_installed: wantsSkills,
      });
      success(`› Signed in · ${email} (account #${idx + 1})`);
      info(`› Use "myapi auth switch" to toggle between accounts.`);
    }

    if (wantsSkills) await installSkills();
  });
}

// myapi auth whoami — show current session info.
export async function whoami(flags: Flags = {}) {
  if (flags.help) { info(WHOAMI_HELP); return; }
  const config = loadConfig();
  if (!config?.api_key) error('Not configured. Run: myapi auth setup');

  let balance: { balance_display: string; credits_display: string } | null = null;
  // Backend returns an array of per-service entries, or null. The SDK type
  // used to lie about this (claimed scalar) — see hq.ts FreeTierEntry.
  let freeTier: Awaited<ReturnType<typeof hq.getFreeTier>> = null;
  // Note any auth-rejection from the balance probe so we don't silently
  // print stale cached config when the key has actually been invalidated
  // server-side. Other failures (endpoint missing, transient 500s) stay
  // swallowed — balance is best-effort, not a key-validation primitive.
  let keyRejected = false;
  try {
    balance = await hq.getBalance(config!.api_key);
  } catch (err: any) {
    if (err?.status === 401 || /invalid api key/i.test(err?.code ?? '')) keyRejected = true;
  }
  // Free-tier query is best-effort — backend may not have it for every
  // account type, and surfacing nothing is better than failing whoami.
  try { freeTier = await hq.getFreeTier(config!.api_key); } catch (err: any) {
    if (err?.status === 401 || /invalid api key/i.test(err?.code ?? '')) keyRejected = true;
  }

  if (flags.json) {
    printJson({
      email: config!.email ?? null,
      account_id: config!.account_id,
      default_org: config!.default_org ?? null,
      default_funnel: config!.default_funnel ?? null,
      is_anonymous: config!.is_anonymous ?? false,
      balance: balance?.balance_display ?? null,
      credits: balance?.credits_display ?? null,
      free_tier: freeTier ?? null,
      key_rejected: keyRejected,
    });
    return;
  }

  if (keyRejected) {
    info('⚠ The backend rejected your API key. The values below are from local config and may not match server state.');
    info('  Run: myapi auth setup');
    info('');
  }

  if (config!.email) info(`Email:    ${config!.email}`);
  info(`Account:  ${config!.account_id}`);
  info(`Org:      ${config!.default_org ?? '(none)'}`);
  info(`Funnel:   ${config!.default_funnel ?? '(none)'}`);
  info(`Type:     ${config!.is_anonymous ? 'anonymous' : 'registered'}`);
  info(`Balance:  ${balance ? `${balance.balance_display}  |  Credits: ${balance.credits_display} (not usable for domains)` : '(unavailable)'}`);
  if (Array.isArray(freeTier) && freeTier.length > 0) {
    const parts = freeTier
      .filter((e) => e && typeof e.service === 'string')
      .map((e) => `${e.service} ${e.used ?? 0}/${e.allowance ?? '?'}`);
    if (parts.length > 0) info(`FreeTier: ${parts.join(' · ')}`);
  }
}

// myapi auth switch [index] — switch between saved accounts.
export async function switchCmd(flags: Flags = {}, indexArg?: string) {
  if (flags.help) { info(SWITCH_HELP); return; }
  const accounts = listAccounts();
  if (accounts.length === 0) error('No accounts configured. Run: myapi auth setup');
  if (accounts.length === 1) {
    info(`Only one account configured: ${accounts[0].email ?? accounts[0].account_id}`);
    info('To add another account, run: myapi auth setup');
    return;
  }

  info('Accounts:');
  for (const a of accounts) {
    const label = a.email ?? (a.is_anonymous ? `anonymous · ${a.account_id.slice(0, 8)}` : a.account_id.slice(0, 8));
    const marker = a.active ? ' ◀ active' : '';
    info(`  ${a.index + 1}. ${label}${marker}`);
  }

  let idxStr = indexArg ?? '';
  if (!idxStr) {
    idxStr = await ask(`› Switch to account (1-${accounts.length})? `);
  }

  // Support email as a stable identifier
  let idx: number;
  const byEmail = accounts.find(a => a.email && a.email.toLowerCase() === idxStr.toLowerCase());
  if (byEmail) {
    idx = byEmail.index;
  } else if (idxStr.includes('@')) {
    error(`No account found with email "${idxStr}". Run "myapi auth switch" to list configured accounts.`);
  } else {
    idx = parseInt(idxStr, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
      error(`Invalid selection "${idxStr}". Use an index number (1-${accounts.length}) or an email address.`);
    }
  }

  if (switchAccount(idx)) {
    const a = accounts[idx];
    success(`› Switched to ${a.email ?? a.account_id}`);
  }
}

// ── myapi auth registrant <set|get|clear> ─────────────────────────────────
//
// Manages the locally-stored WHOIS registrant info that `myapi domain
// register` injects into every call. `set` is the one-time interactive
// setup; `--registrant-json` is the agent-friendly bypass. `get` and
// `clear` are housekeeping.

const REGISTRANT_HELP = `Usage: myapi auth registrant <set|get|clear>

Manages the locally-stored WHOIS contact info that \`myapi domain register\`
requires (ICANN-mandated). Stored in ~/.myapi/config.json under the active
account; never synced to the backend except as a per-request field.

Subcommands:
  clear     Remove the stored registrant from the active account.
  get       Print the stored registrant (or "not set").
  set       Interactive prompt for all fields. Or pass --registrant-json
            '<json>' to set non-interactively (agent-friendly).`;

export async function registrant(sub: string | undefined, flags: Flags = {}) {
  if (flags.help || !sub) { info(REGISTRANT_HELP); return; }

  const config = requireConfig();

  switch (sub) {
    case 'set': {
      // Agent path: --registrant-json '<inline>' writes directly without prompting.
      const inlineJson = typeof flags['registrant-json'] === 'string' ? flags['registrant-json'] as string : null;
      if (inlineJson) {
        let parsed: any;
        try { parsed = JSON.parse(inlineJson); }
        catch (e: any) { error(`--registrant-json is not valid JSON: ${e.message}`); }
        const required = ['name', 'email', 'phone', 'street', 'city', 'postal_code', 'country_code'];
        const missing = required.filter(k => !parsed[k]);
        if (missing.length > 0) error(`Missing required field(s): ${missing.join(', ')}`);
        saveConfig({ ...config, registrant: parsed });
        success('Saved registrant from --registrant-json.');
        return;
      }
      const r = await promptAndSaveRegistrant(config, config.registrant);
      success(`Saved. ${r.name} · ${r.email} · ${r.country_code}`);
      return;
    }
    case 'get': {
      if (!config.registrant) {
        info('No registrant stored. Set one with: myapi auth registrant set');
        return;
      }
      if (flags.json) { printJson(config.registrant); return; }
      const r = config.registrant;
      info(`Name:        ${r.name}`);
      info(`Email:       ${r.email}`);
      info(`Phone:       ${r.phone}`);
      info(`Street:      ${r.street}`);
      info(`City:        ${r.city}`);
      if (r.state) info(`State:       ${r.state}`);
      info(`Postal code: ${r.postal_code}`);
      info(`Country:     ${r.country_code}`);
      return;
    }
    case 'clear': {
      if (!config.registrant) { info('No registrant stored — nothing to clear.'); return; }
      const { registrant: _drop, ...rest } = config;
      saveConfig(rest);
      success('Cleared.');
      return;
    }
    default:
      error(`Unknown subcommand: ${sub}. Run \`myapi auth registrant --help\` for the list.`);
  }
}
