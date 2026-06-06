import { hq } from '@myapihq/sdk';
import { requireConfig } from '../config.js';
import { success, error, printTable, info, printJson } from '../output.js';
import { confirm, isNonInteractive } from '../prompt.js';
import { formatDate } from '../utils.js';
import type { FlagSchema } from '../flags.js';
import type { Flags } from '../helpers.js';
import type { Exposes } from '../exposes.js';

export const SCHEMA: FlagSchema = {
  period: 'string',   // spend-cap window: month | day
};

export const EXPOSES: Exposes = [
  'GET /hq/billing/balance',
  'GET /hq/billing/history',
  'GET /hq/billing/usage',
  'POST /hq/billing/setup-payment',
  'POST /hq/billing/topup',
  'GET /hq/account/me',
  'PATCH /hq/account/spend-cap',
];

const SUBCOMMAND_USAGE: Record<string, string> = {
  'balance': 'myapi billing balance [--json]',
  'history': 'myapi billing history [--json]',
  'usage':   `myapi billing usage [--period month|30d] [--json]

Spend rolled up by service — the accurate "where is my money going" view.
Aggregates every billing event, unlike the flat history log. Defaults to
the current calendar month; --period 30d gives the trailing 30 days.`,
  'topup':   `myapi billing topup <amount> [--yes]

Amount is in whole dollars (e.g. "10" charges $10).
Confirmation is required for amounts of $50 or more — pass --yes to skip it.

Example: myapi billing topup 10`,
  'setup':   'myapi billing setup',
  'spend-cap': `myapi billing spend-cap [<amount> | clear] [--period month|day]

The account-level spend ceiling (IAM "Layer 2") — a self-imposed limit
*below* your balance that bounds total spend across every key and function.

  myapi billing spend-cap              Show the current cap + period spend
  myapi billing spend-cap 50           Cap total spend at $50/month
  myapi billing spend-cap 5 --period day   Cap at $5/day
  myapi billing spend-cap clear         Remove the cap

This is distinct from a per-key cap (myapi keys create --spend-cap). The
account cap is the aggregate backstop; per-key caps bound each credential.`,
};

export async function run(subcommand: string | undefined, args: string[], flags: Flags) {
  if (!subcommand || (flags.help && !subcommand)) {
    info(`Usage: myapi billing <subcommand>

Subcommands:
  balance    Check balance, credits, and payment method status
  history    View recent transactions and top-ups
  setup      Open a checkout link to add or update payment method
  spend-cap  Set/show/clear the account-level spend ceiling (IAM Layer 2)
  topup      Top up your balance (whole dollars)
  usage      Spend rolled up by service (this month, or --period 30d)`);
    return;
  }

  if (flags.help) {
    const usage = SUBCOMMAND_USAGE[subcommand];
    if (usage) info(`Usage: ${usage}`);
    else info(`Unknown subcommand: ${subcommand}. Run "myapi billing --help" for the list.`);
    return;
  }

  switch (subcommand) {
    case 'balance':   return balance(flags);
    case 'history':   return history(flags);
    case 'usage':     return usage(flags);
    case 'topup':     return topup(args[0], flags);
    case 'setup':     return setup(flags);
    case 'spend-cap': return spendCap(args[0], flags);
    default: error(`Unknown subcommand: ${subcommand}. Run "myapi billing --help" for available subcommands.`);
  }
}

export async function balance(flags: Flags) {
  const config = requireConfig();
  const result = await hq.getBalance(config.api_key);

  if (flags.json) {
    printJson({
      balance: result.balance_display,
      credits: result.credits_display,
      has_payment_method: result.has_payment_method,
    });
    return;
  }

  const pm = result.has_payment_method ? 'yes' : 'no';
  const accountType = config.is_anonymous ? 'anonymous' : `registered (${config.email ?? ''})`;
  info(`Account: ${accountType}`);
  info(`Balance: ${result.balance_display}  |  Credits: ${result.credits_display} (not usable for domains)  |  Payment method: ${pm}`);
  // Anonymous accounts can't transact — paid surface is gated on a
  // verified email and credits only fund on upgrade. Surface the unblock.
  if (config.is_anonymous) {
    info('→ Link an email to unlock $5 free credit + paid actions: myapi auth link <email>');
  }
}

export async function history(flags: Flags) {
  const config = requireConfig();
  const items = await hq.getBillingHistory(config.api_key);

  if (flags.json) { printJson(items); return; }

  const formattedItems = items.map(item => ({
    Type: item.type || 'unknown',
    Amount: item.amount_display,
    Status: item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : '',
    Date: formatDate(item.created_at),
  }));

  printTable(formattedItems, {
    flags,
    empty: 'No transactions yet.',
  });
}

// Spend rolled up by service. Aggregates every billing event over the
// window (current calendar month, or trailing 30 days with --period 30d) —
// the accurate "where is my money going" view, distinct from `history`.
export async function usage(flags: Flags) {
  const config = requireConfig();
  const period = (flags.period as string) || 'month';
  if (period !== 'month' && period !== '30d') {
    error(`Invalid --period "${period}". Use month or 30d.`);
  }
  const res = await hq.getBillingUsage(config.api_key, period as 'month' | '30d');
  if (flags.json) { printJson(res); return; }

  info(`Spend by service — ${res.period === '30d' ? 'last 30 days' : 'this month'} (since ${formatDate(res.since)})`);
  printTable(res.services.map(s => ({
    Service: s.service,
    Requests: s.requests,
    Cost: s.cost_display,
  })), {
    flags,
    empty: 'No usage recorded in this window.',
  });
  info(`Total: ${res.total_display}`);
}

export async function topup(amountStr: string, flags: Flags) {
  const amount = Math.round(parseFloat(amountStr));
  if (!amountStr || isNaN(amount) || amount <= 0) {
    error('Amount must be a positive whole number of dollars (e.g. myapi billing topup 10)');
  }

  if (!flags.yes && !flags.y && amount >= 50) {
    // Refuse loudly in non-interactive contexts (agent harnesses, CI) instead
    // of either hanging on a prompt no human will answer, or silently
    // auto-cancelling with no actionable error. Force the caller to pass --yes.
    if (isNonInteractive()) {
      error(`Charge of $${amount} requires confirmation. Re-run with --yes:\n  myapi billing topup ${amount} --yes`);
    }
    const ok = await confirm(`› Charge $${amount} to your saved payment method? (y/N) `, false);
    if (!ok) { info('Cancelled.'); return; }
  }

  const config = requireConfig();
  const result = await hq.topUp(config.api_key, amount);
  success(`Top up successful! New balance: ${result.new_balance_display}`);
}

export async function setup(_flags: Flags) {
  const config = requireConfig();
  const result = await hq.setupPayment(config.api_key);
  success(`Open this URL in your browser to set up payment:\n${result.url}`);
}

// The account-level spend ceiling. No arg → show; "clear" → remove; a
// dollar amount → set. Distinct from per-key caps (myapi keys create
// --spend-cap): this is the aggregate backstop across the whole account.
export async function spendCap(arg: string | undefined, flags: Flags) {
  const config = requireConfig();

  if (!arg) {
    const acct = await hq.getAccount(config.api_key);
    if (flags.json) {
      printJson({
        spend_cap_cents: acct.spend_cap_cents ?? null,
        current_period_spend_cents: acct.current_period_spend_cents ?? null,
      });
      return;
    }
    if (acct.spend_cap_cents == null) {
      info('No account spend cap set.');
      info('Set one with: myapi billing spend-cap <dollars> [--period month|day]');
    } else {
      const spent = acct.current_period_spend_cents ?? 0;
      info(`Account spend cap: $${(spent / 100).toFixed(2)} spent / $${(acct.spend_cap_cents / 100).toFixed(2)} this period`);
    }
    return;
  }

  if (arg === 'clear' || arg === 'none') {
    await hq.setAccountSpendCap(config.api_key, null);
    success('Account spend cap cleared.');
    return;
  }

  const dollars = Number(arg);
  if (!Number.isFinite(dollars) || dollars < 0) {
    error(`Invalid amount "${arg}". Use a non-negative dollar amount, or "clear" to remove the cap.\nExample: myapi billing spend-cap 50`);
  }
  const period = (flags.period as string) || 'month';
  if (period !== 'month' && period !== 'day') {
    error(`Invalid --period "${period}". Use month or day.`);
  }
  const res = await hq.setAccountSpendCap(config.api_key, Math.round(dollars * 100), period as 'month' | 'day');
  const cents = res.spend_cap_cents ?? Math.round(dollars * 100);
  success(`Account spend cap set: $${(cents / 100).toFixed(2)} per ${res.spend_cap_period}.`);
}
