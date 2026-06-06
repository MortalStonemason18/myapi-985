// `myapi account` — account-scoped operations.
//
// Today: mailing-address (CAN-SPAM compliance for transactional email).
// Future home for any other account-level reads/writes that don't fit
// `billing` (which owns money) or `keys` (which owns auth credentials).

import { hq as sdkHq } from '@myapihq/sdk';
import { requireConfig } from '../config.js';
import { success, error, info, printJson } from '../output.js';
import type { FlagSchema } from '../flags.js';
import type { Flags } from '../helpers.js';
import type { Exposes } from '../exposes.js';

export const SCHEMA: FlagSchema = {};

export const EXPOSES: Exposes = [
  'GET /hq/account/mailing-address',
  'PATCH /hq/account/mailing-address',
];

const SUBCOMMAND_USAGE: Record<string, string> = {
  'mailing-address': `myapi account mailing-address                       Show current value (null if unset)
myapi account mailing-address "<address>"            Set the mailing address

The mailing address is required for transactional email (CAN-SPAM):
\`email message send\` returns MAILING_ADDRESS_REQUIRED until this is set.
Pass the full postal address as a single string — e.g.
"123 Main St, Springfield, IL 62701, USA".`,
};

async function mailingAddress(args: string[], flags: Flags) {
  const config = requireConfig();
  // Positional arg present → set. Absent → get.
  const value = args[0];
  if (value === undefined) {
    const res = await sdkHq.getMailingAddress(config.api_key);
    if (flags.json) { printJson(res); return; }
    if (res.mailing_address) {
      info(`Mailing address: ${res.mailing_address}`);
    } else {
      info('Mailing address: (not set)');
      info('Set it with: myapi account mailing-address "<address>"');
      info('Required for: myapi email message send (CAN-SPAM).');
    }
    return;
  }
  // Reject obviously bad inputs early — the backend would 400 anyway.
  const trimmed = value.trim();
  if (!trimmed) {
    error('Mailing address must be a non-empty string. Example: "123 Main St, Springfield, IL 62701, USA".');
  }
  const res = await sdkHq.setMailingAddress(config.api_key, trimmed);
  if (flags.json) { printJson(res); return; }
  success(`Mailing address set: ${res.mailing_address}`);
}

export async function run(subcommand: string | undefined, args: string[], flags: Flags) {
  if (!subcommand || (flags.help && !subcommand)) {
    info(`Usage: myapi account <subcommand>

Subcommands:
  mailing-address    Get or set the account's mailing address (CAN-SPAM)`);
    return;
  }
  if (flags.help) {
    const usage = SUBCOMMAND_USAGE[subcommand];
    if (usage) info(`Usage: ${usage}`);
    else info(`Unknown subcommand: ${subcommand}. Run "myapi account --help" for the list.`);
    return;
  }
  switch (subcommand) {
    case 'mailing-address': return mailingAddress(args, flags);
    default: error(`Unknown subcommand: ${subcommand}. Run "myapi account --help" for the list.`);
  }
}
