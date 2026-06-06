# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.12] — 2026-06-06

### Added

- **OpenAI-compatible chat completions documented in `my-llm-api`
  SKILL.** Backend shipped `POST /llm/orgs/{org_id}/chat/completions`
  (and `/v1/chat/completions` alias) — drop-in for the OpenAI SDK,
  LangChain, LlamaIndex, anything that takes a `base_url`. Same
  catalog and pricing as raw `complete`; OpenAI request and response
  shape (no MyAPI envelope). Skill now includes the Python OpenAI
  client snippet pointing at `…/llm/orgs/<org>/v1`.

### Changed

- **CRM contacts / companies EXPOSES extended.** Backend added bare
  GET list endpoints (`GET /crm/orgs/{org}/contacts`,
  `GET /crm/orgs/{org}/companies`) alongside the existing POST /search
  verbs. CLI list verb still uses /search; the GET is declared so
  coverage stays honest (richer query-param filters available for
  consumers that prefer GET).
- **`my-llm-api` SKILL.md trimmed** to fit the 8000-char body budget
  while adding the OpenAI-compat block (kept the H-3 draft-context
  safety guard documented, just denser).

### Coverage

- `GET /image/orgs/{org_id}/generate/{id}` allowlisted as
  `documentation-alias` (REST-instinct alias of `/jobs/{id}`, same
  handler — already covered by `image get-job`).
- `POST /llm/orgs/{org_id}/chat/completions` + `v1/chat/completions`
  allowlisted as `openai-compat` (drop-in for OpenAI SDK at
  `base_url`, not invoked via the CLI).

## [1.3.11] — 2026-06-06

### Added

- **`myapi account mailing-address` (get + set).** Wires the
  `PATCH/GET /hq/account/mailing-address` endpoints the backend shipped
  2026-06-06. Required for transactional `email message send`
  (CAN-SPAM); the gate was previously unfixable from CLI/SDK.
- **`myapi email mailbox delete <user@domain>`.** Wires the new
  `DELETE /email/mailboxes/{address}` idempotent endpoint. Returns
  success whether or not the mailbox existed; surfaces `MAILBOX_IN_USE`
  when an active/paused campaign still sends from it.
- **`myapi domain mail-server-resync <domain>`.** Re-runs the Stalwart
  mail-server provisioning side (distinct from `retry-provisioning`,
  which re-runs DNS/cert). Live-fixed the shroombloom.xyz-style
  "mail server error" the email post-deploy prompt flagged — backend
  shipped the endpoint, CLI exposes the verb, verified end-to-end
  (inbox went from `mail server error` to `No messages` within 20s).
- **`myapi doctor` setup section now flags missing `mailing_address`.**
  Reads via `GET /hq/account/mailing-address`; warns when null, silent
  when the call fails (no false alarms on infra blips). Extends the
  `setup` augmentation shipped in 1.3.10. 9/9 unit tests in
  `doctor-setup.test.ts`.
- **`myapi doctor` setup section** (carry-over from 1.3.10, missed in
  that release's CHANGELOG) — re-interprets the backend's `domains`
  and `emails` sections: zero-state → actionable warn. Reactive design,
  disappears as soon as the backend doctor learns to flag this directly.

### SDK

- `hq.getMailingAddress` / `hq.setMailingAddress`
- `email.deleteMailbox`
- `email.mailServerResync`

### Coverage

- `GET /email/unsubscribe/{tok}` + `POST /email/unsubscribe/{tok}`
  allowlisted as `public-endpoint` (RFC 8058 one-click unsubscribe;
  mail clients POST automatically, not CLI-driven).

## [1.3.10] — 2026-06-05

### Changed — SDK boundary cleanup

- **SDK `getFunnel` now returns `GetFunnelResponse`** (the typed envelope
  `{funnel, subdomain_url?, domain_url?}`) instead of the misleading
  `Funnel` return type that actually delivered the envelope at runtime.
  SDK normalizes the wire shape — if a future backend ever returns a
  flat `Funnel`, it's wrapped at the boundary. Downstream call sites in
  the CLI (`funnel get`, `funnel form`, `config set-funnel`) lose their
  `as any` + `raw.funnel ?? raw` workarounds. `funnel get --json` output
  shape is unchanged. Minor visual change: `funnel get` no longer prints
  the `Pages:` count (it was reading off the envelope and rarely populated
  — use `myapi funnel pages` for that).

## [1.3.9] — 2026-06-05

### Changed

- **`myapi funnel form` now always registers a per-slug binding.**
  Without `--capture-to`, it auto-targets the funnel's
  `org_webhook_id` (the same destination as the default fallback) so
  the server-side honeypot + field validation actually fire. Before
  this, the on-page honeypot was purely cosmetic on the zero-config
  path — trivial bots wrote straight to CRM. Backend POST upserts on
  duplicate slug, so re-runs are safe. Surfaces a warning on stderr
  when the funnel has no `org_webhook_id` (legacy, pre-2026-06-03).

## [1.3.8] — 2026-06-04

### Added

- **`myapi funnel form` — backend-aligned canonical recipe.** Replaces
  the v1 emitter with the contract shipped by the backend on 2026-06-03
  (merge `d1f3956` in myapi-hq). New syntax: `--fields` accepts
  repeatable specs with type + required modifiers
  (`email:required,name,phone:tel`); auto-emits a hidden honeypot input
  (default name `middle_name`, overridable with `--honeypot`); new
  `--capture-to webhook:<uuid>` / `workflow:<uuid>` flag registers a
  per-slug binding via `POST /funnel/orgs/.../funnels/{id}/forms`. HTML
  shape matches the backend prompt: `data-myapi-form` attribute, bulk
  submit-handler script, copy-paste friendly. CRM ingest fires on the
  `email` field automatically through the funnel's auto-provisioned
  webhook.
- **SDK: `Funnel.org_webhook_id` typed** (was in the response, not in
  the interface). Three new functions for the forms binding endpoints:
  `createFormBinding`, `listFormBindings`, `deleteFormBinding`.

### Changed

- **`my-funnel-api` SKILL.md** — canonical form-capture recipe is the
  funnel proxy. Hardcoded `api.mywebhookapi.com/webhook/in/...` URLs in
  funnel HTML are explicitly called out as an anti-pattern.
- **`my-webhook-api` SKILL.md** — scope statement reworded: webhooks are
  for non-funnel inbound (Stripe, GitHub, custom services). Funnel forms
  point at my-funnel-api.

- **`workflow create` URL validation tightened.** The CLI/SDK `http_request`
  step URL is now parsed and the protocol checked (`http://`/`https://`
  only) instead of a prefix-regex on the raw string. Catches
  `javascript:`, `file:`, `gopher:`, `data:`, and whitespace/null-byte
  hosts that previously slipped through. Mirrors the same check already
  on `webhook --forward-url` and `queue --consumer-url`. Defense in
  depth — the backend SSRF middleware is the source of truth (see
  `docs/cross-repo-prompts/backend-workflow-step-validation.md`).

## [1.3.7] — 2026-06-01

### Changed — `my-llm-api`: two-surface relist (raw + objective verbs)

Wires the CLI + SDK to the backend's two-surface LLM primitive
(`backend-llm-two-surface.md`, shipped to prod 2026-05-28).

- **Raw surface** repointed off Gemini (paused over resale terms) onto
  the self-hosted catalog (today: `Qwen/Qwen3-Coder-30B-A3B-Instruct`).
  `myapi llm complete` defaults to the first chat model from the live
  catalog when `--model` is omitted; pass any other id and the backend
  returns `MODEL_NOT_IN_RAW_CATALOG` pointing at the verb surface.
- **Verb surface** — four new subcommands: `myapi llm classify` /
  `extract` / `summarize` / `draft`. Shared `--tier fast|reasoning|cheap`
  hint; output to stdout, usage footer to stderr.
- **Pricing in cents.** Catalog fields are `input_cost_per_1m_cents` /
  `output_cost_per_1m_cents` / `context_window`; response usage carries
  `cost_cents` (replaces `cost_usd`). Aligns the LLM meter with the rest
  of the platform.
- **`embed`** returns `EMBED_NOT_AVAILABLE` until an embedding model is
  served — no per-model "unknown" guessing.
- SKILL.md + README rewritten for the two surfaces; bundled skill stays
  byte-equal between `packages/cli/src/skills/my-llm-api/` and
  top-level `skills/my-llm-api/`.

## [1.3.6] — 2026-05-27

### Changed

- **All `--help` listings are now alphabetized** — top-level commands,
  subcommand blocks, namespace blocks, options, and aliases. The principle:
  predictable order over curated narrative. Mechanical to maintain and
  scan; future commands slot in by name.

## [1.3.5] — 2026-05-27

### Fixed

- **`myapi domain import`** — defended against a malformed backend response
  in the `pending_ns_change` state, where `nameservers` came back as a
  string (the `domain_id` value mis-serialized) instead of a string array
  and `preserved_records` was absent. The CLI used to iterate the string
  character-by-character and then crash on `undefined.length`; it now
  warns clearly and points at `myapi domain status` to retrieve the real
  nameservers. Backend fix tracked separately.

## [1.3.4] — 2026-05-21

### Changed

- Refreshed the bundled OpenAPI snapshot to the live schema
  (`api.myapihq.com/schema/v1/openapi.json`) — 225 method+path pairs.
  Verified: 0 endpoints removed, 0 SDK `EXPOSES` entries orphaned, all 18
  newly-added endpoints (doctor, queue, task, container custom-domain)
  already covered. `DoctorIssue.category` documentation corrected to the
  schema's vocabulary — `internal` is a backend category; `network` is the
  CLI augmentation's own.

## [1.3.3] — 2026-05-21

### Added

- **`myapi doctor` — HTTP reachability section.** A new local augmentation
  pass, alongside the DNS probe: it enumerates the org's containers and
  funnel pages, issues an HTTP GET to each (8s timeout, redirects followed),
  and surfaces the status code. This turns doctor from "the config is
  consistent" toward "the site actually answers" — the backend can't run
  this from its own egress. Failures are `warn`, never `crit`: a single
  fetch from one machine isn't authoritative enough to fail CI.

### Fixed

- **`myapi doctor`** — `--json` now honours the exit code: a critical issue
  exits 1 in JSON mode too (previously the JSON branch returned before the
  exit-code logic, so CI using `--json` never failed). Issues are now
  prefixed with their entity name, so sibling rows with identical messages
  (e.g. four `domain is active` checks) are distinguishable. The severity
  tally ignores any unmodelled severity instead of poisoning totals to `NaN`.

## [1.3.2] — 2026-05-20

### Added

- **`myapi doctor`** — org-wide consistency report. Fetches a structured
  report from the backend (`GET /hq/orgs/{org_id}/doctor`) covering funnels,
  webhooks, workflows, domains, containers, email infra, and payments, then
  augments it with local DNS-resolution probes for each domain in the
  report. Exit 1 on critical issues; `--verbose` shows passing checks too;
  `--json` for machine-readable output. SDK: new `hq.getDoctor` with typed
  `DoctorReport`, `DoctorSection`, `DoctorIssue`, `DoctorEntityRef`,
  `DoctorSeverity`.

## [1.3.1] — 2026-05-19

### Added

- **`myapi container domain <id> <domain>`** — bind a custom domain to a
  deployed container, served over HTTPS via Cloudflare; `--remove` unbinds it.
  SDK: `container.bindDomain` / `container.unbindDomain`, and the `Container`
  type gains a `custom_domain` field.

## [1.3.0] — 2026-05-19

### Added

- **`myapi queue`** — a new command for the durable job queue: create queues
  bound to an HTTP consumer, enqueue jobs (with `--dedup-key`, `--delay`,
  `--depends-on`), and inspect jobs. SDK: new `queue` module.
- **`myapi task`** — a new command for the agent-task queue: file, list
  (ranked), claim under a lease, extend, resolve, fail, and cancel tasks;
  `task get --body` fetches the Markdown body tier on demand. SDK: new `task`
  module.
- **`enqueue_job` workflow step** — workflows can now hand durable work to a
  queue. SDK: new `WorkflowStep` variant; CLI: `--steps` validation accepts
  `enqueue_job` (alias `enqueue`).
- **Orchestration decision guide** (`docs/orchestration-decision-guide.md`) —
  when to reach for `workflow` vs `queue` vs `task`.

### Changed

- `services.ts` gains an `orchestrate` category; `workflow`, `queue`, and
  `task` now live in it.

## [1.2.9] — 2026-05-18

### Added

- **`myapi git`** — a new command for hosted git repositories: create repos,
  commit files, manage branches and tags, and read trees, blobs, commit
  history, and diffs. SDK: new `git` module.
- **`myapi email verify bulk`** — asynchronous bulk email verification (reads
  addresses from stdin; `--quick` skips the catch-all check), with
  **`myapi email verify job <id>`** to poll. SDK: `email.verifyBulk` /
  `email.getVerifyJob`.

### Changed

- The email service is now GA — the customer-facing surface (mailboxes,
  campaigns, templates, warmup) is no longer pre-launch-gated.

### Fixed

- `myapi pixel identity` now sends the required `--website` argument — the
  backend scopes identity resolution to a domain the org owns.

## [1.2.8] — 2026-05-17

### Added

- **`myapi container logs <id> [--tail <n>]`** — recent Cloud Run runtime
  logs for a container, newest first. `--tail` caps the count (default 100,
  max 1000). SDK: `container.getContainerLogs`.

## [1.2.7] — 2026-05-16

A performance and supply-chain hardening release — no new commands.

### Security

- Removed the `omelette` dependency. Shell completion is now hand-rolled
  first-party code, so the CLI has **zero third-party runtime dependencies**
  (its only dependency is the MyAPI SDK). An unmaintained package on a
  globally-installed CLI that reads your API key on every run is an
  unacceptable supply-chain compromise vector.

### Changed

- List commands emit token-dense output: redundant and derivable columns
  (`org_id`, the webhook `url`, the email `body`, …) are dropped from the
  default table. Agents reading list output spend roughly 50% fewer tokens.
  `--json` is unchanged — it still returns the complete records.
- `myapi --version` no longer blocks on a network call. The npm update
  check is cached (6h TTL), cutting `--version` from ~1.1s to ~0.1s.

## [1.2.6] — 2026-05-16

Adds the client surface for three newly-shipped backend areas — deployable
edge functions, directory-based site publishing, and payments.

### Added

- **`myapi fn deploy <id> <bundle.js>`** — upload a single-file JavaScript
  bundle to the edge runtime and go live. Also **`myapi fn env <id> <name>
  <value>`** to set a Worker secret on a deployed function, and **`myapi fn
  runs <id>`** to list recent invocations.
- **`myapi funnel publish <dir>`** — publish a whole local directory as the
  funnel's site (`--env dev|prod`), with optional `--api-fn <id>` to bind
  `/api/*` to a deployed function.
- **`myapi payments`** — a new command for Stripe payments: `connect` your
  Stripe account, `charge` (one-off or recurring) for a hosted checkout URL,
  plus `list`, `get`, and `refund`.
- SDK: `fn.uploadBundle` / `setFunctionEnv` / `listFunctionRuns`,
  `funnel.publishFiles`, and a new `payments` module.

## [1.2.5] — 2026-05-14

Wires the assign-www + canonical-redirect shipment from backend (apex + www
Worker routes bound by default, www 301-redirects to apex).

### Added

- **`myapi domain assign <domain> [--no-www]`** — opt out of binding the www
  Worker route. The default behavior (both apex and www bound, www 301-
  redirects to apex with path/query preserved) matches every modern hosting
  platform's convention and is now reflected verbatim in the CLI success
  message:

  ```
  ✓ Assigned x80security.com to org 0717...
    Worker routes bound: x80security.com/*  and  www.x80security.com/*
    www.x80security.com 301-redirects to https://x80security.com/ (canonical apex)
  ```

  The routes are pulled from the assign response (`routes_bound[]`) rather
  than hardcoded, so a future backend convention change surfaces correctly
  without a CLI change.

- **Pre-flight warning in `myapi domain assign --help`.** Documents that
  assign is also the *re-assign* path — running it with a different `--org`
  moves the domain. Recommends `myapi domain list --filter all` to confirm
  current binding first.

### Changed

- SDK `assignDomain(apiKey, orgId, domain, opts?)` now returns the new
  `AssignDomainResponse` shape `{ domain, org_id, include_www, routes_bound }`
  instead of `DomainRecord`. Old callers that destructured `DomainRecord`
  fields will compile-error; intentional.

## [1.2.4] — 2026-05-14

Catches up to the backend's BYOD-followup shipment: email infra is now
opt-in on a subdomain, provisioning failures surface a real reason, and
retry is a first-class command.

### Added

- **`myapi domain email-setup <domain> [--subdomain <label>]`** — opt in to
  MyAPI-managed outbound email. Always provisions on a subdomain (default:
  `mail.<domain>`); apex is never touched. Customer's existing apex email
  setup (Google Workspace, Microsoft 365, etc.) stays 100% untouched.
- **`myapi domain retry-provisioning <domain>`** — re-run the provisioning
  pipeline when `status=infra_error` and `error_detail.retryable=true`. The
  status renderer surfaces the retry command automatically when applicable.
- **Rich status rendering.** `myapi domain status` now displays `DNS:`,
  `Email:` (state + subdomain), and `Failed step / Message / Attempts` when
  in `infra_error`. The CLI hints at the retry command inline.
- `infra_error` is now a terminal state for `--watch` (acting on it requires
  human decision — retry or contact support — so the watch loop exits).

### Changed

- SDK `DomainRecord` interface extended with `email_infra`, `email_subdomain`,
  `dns_active`, `steps_completed`, and `error_detail` fields surfaced by the
  backend's new status response shape.

## [1.2.3] — 2026-05-14

### Fixed

- **CF_API_ERROR now surfaces the underlying `cf_message` and `cf_status`.**
  Previously the CLI rendered a generic "Cloudflare API error" and dropped the
  useful detail (record-conflict reasons, validation hints, etc.). Now you see
  the actual Cloudflare response: e.g. *"Cloudflare API error 81062: A DNS
  record managed by Workers already exists on that host. (HTTP 400)"*.

  Implemented generically so future per-service error-detail fields don't need
  a CLI change to surface — SDK's `MyApiError` now carries the full backend
  error object as `err.body`, and `friendlyError()` knows how to render it.

## [1.2.2] — 2026-05-14

Domain DNS records — full CRUD surface in the zones MyAPI holds for you,
whether the domain came via `register` or BYOD `import`.

### Added

- **`myapi domain records list <domain> [--type T]`** — list DNS records
  (A / AAAA / CNAME / MX / TXT) in the Cloudflare zone. Renders type, name,
  content, TTL (with `auto` for CF's automatic-sentinel `1`), priority, and
  proxied flag. `--type` filters server-side.
- **`myapi domain records get <domain> <record-id>`** — fetch a single record.
- **`myapi domain records create <domain> --type T --name n --content c
  [--ttl] [--priority] [--proxied]`** — create a record. Name accepts `@`,
  empty, host-only (`mail`), or FQDN (`mail.example.com`); the backend
  normalizes to FQDN. `--priority` required for MX. `--proxied` (CF
  orange-cloud) applies to A/AAAA/CNAME only.
- **`myapi domain records update <domain> <id> [--content] [--ttl]
  [--priority] [--proxied] [--name]`** — patch a record. Type cannot change.
- **`myapi domain records delete <domain> <id> --yes`** — delete. Confirmation
  required unless `--yes`.
- Friendly error mappings: `RECORD_NOT_FOUND`, `INVALID_RECORD_TYPE`,
  `MX_PRIORITY_REQUIRED`, `INVALID_TTL`, `INVALID_RECORD_CONTENT`,
  `RECORD_LIMIT_EXCEEDED`, `CF_API_ERROR`.

### Why

After a BYOD `import`, the probe snapshots whatever DNS the customer's
existing registrar serves — including malformed records. Without a records
surface, customers had no way to clean up before the NS swap. This closes
that loop; for the motivating incident, see `docs/backend-sync/DOMAIN-RECORDS-SPEC.md`.

## [1.2.1] — 2026-05-14

Catch-up to the backend's BYOD import rewrite. The domain-import surface is now
registrar-agnostic — no more Namecheap-only path.

### Added

- **`myapi domain import <domain>`** — BYOD subcommand. Snapshots existing DNS
  records via a best-effort public probe, creates a Cloudflare zone, and prints
  the nameservers the customer needs to set at their current registrar.
  Preserved records (MX/SPF/DKIM/DMARC etc.) render as a clean table so the
  customer can verify before swapping NS. No registrar credentials required.
- **`myapi domain status <domain> --watch`** — polling loop with 10s × 30 then
  30s × 60 backoff (~35 min budget). Each poll triggers a live Cloudflare
  zone-status check on the backend, which drives the flip from
  `pending_ns_change` → `provisioning` once the customer has updated their NS.

### Changed

- **SDK `importDomain` signature.** Now `importDomain(apiKey, orgId, domain)`
  with response type `ImportDomainResponse` (`{ domain, domain_id, status,
  nameservers, preserved_records, preserved_count, probe_warning, next_step }`).
  Old `namecheap_api_user` / `namecheap_api_key` payload fields are gone — the
  backend no longer accepts them.
- Schema snapshot refreshed against backend `7f22120` (2026-05-14 deploy).

## [1.2.0] — 2026-05-13

The platform-substrate release. Adds three new primitives that close the
"agent can build the engine of a company" gap (KV store, CRM, LLM gateway),
plus image generation tuning, email verification, and the registrant flow
for ICANN-compliant domain registration.

### Added

- **`myapi llm` — provider-agnostic LLM completions + embeddings.** Three
  subcommands: `complete`, `embed`, `models`. Routes to managed Gemini today
  at upstream cost; the model id is just a string so additional providers
  land without breaking callers. `complete` defaults to
  `gemini-3.1-flash-lite-preview` when `--model` is omitted.
- **`myapi database` — per-org KV store.** Namespaces, JSON values up to
  256 KB, prefix-scan listing, optimistic concurrency via `If-Match` etags
  (CAS). Seven subcommands: `namespaces`, `create`, `delete-namespace`,
  `keys`, `get`, `set`, `del`. The substrate for stateful agent-built apps.
- **`myapi crm` — canonical store of engaged contacts + companies.**
  Multi-level CLI under `myapi crm contacts` and `myapi crm companies` with
  `list / search / get / create / update / delete / restore / promote`,
  plus `events` on contacts for the append-only timeline. Fixed lifecycle
  stage enum (`cold | warm | qualified | customer | churned`), soft delete
  with restore, reserved event kinds. Promote-from-Goldfox closes the
  discovery → engagement loop.
- **`myapi image models`** and **`myapi image generate --model <id>`** —
  catalog of image-gen models with per-image pricing; caller picks the
  model. Default `gemini-2.5-flash-image`.
- **`myapi email verify`** — sync single-address email verification (syntax
  + DNS + Microsoft GetCredentialType probe). The cheap pre-send quality
  gate.
- **WHOIS registrant flow for `myapi domain register`.** ICANN-required
  contact info (name, email, phone, address, country, optional state +
  organization). Five-tier resolution: `--registrant-json` → per-field
  flags (`--registrant-name`, etc.) → stored config → interactive TTY
  prompt → friendly error in non-interactive contexts. New
  `myapi auth registrant set | get | clear` subcommand to manage stored
  defaults.
- **Webhook `--crm-email-path`** — per-endpoint dot-path config for
  auto-ingest of inbound webhook bodies into CRM (defaults to top-level
  `email`; e.g. `data.object.customer_email` for Stripe).
- **Canonical service registry.** `packages/sdk/src/services.ts` is now
  the single source of truth for the 17 MyAPI primitives. Drives
  `skills/<name>/claude/.claude-plugin/plugin.json` regeneration via
  `npm run canonical-sync`. New `services-sync.test.ts` fails CI on drift.
- **`SERVICE_NOT_LAUNCHED` friendly error.** When the backend gates a
  primitive pre-launch (currently `email`, `people`, `company`, `audience`),
  the CLI surfaces a clean "This service is disabled pre-launch" message
  pointing at `myapi status` instead of a raw error code.
- **Anonymous-account hints (companion to backend Option C).** Anon
  accounts now mint with `$0` credit; the upgrade-via-email grants $5.
  Hints fire on `INSUFFICIENT_BALANCE`, `myapi billing balance`,
  `myapi auth setup --anonymous`, and `myapi status` to surface the
  conversion path.
- New SDK base URL fallback to `api.myapihq.com` for the primitives whose
  per-service brand hosts (e.g. `api.myllmapi.com`) don't yet resolve in
  DNS — fixes the entire `crm / llm / database / people / company /
  audience` surface in production.

### Changed

- **`myapi install-skills` promoted to top-level command.** Run directly
  rather than nested under `auth`. The top-level form is the documented
  entry point and appears in `myapi --help`.
- **`myapi domain register` request body now takes
  `{ years, registrant }` instead of `years` directly** — `registrant`
  is required server-side under `REGISTRAR_PROVIDER=cloudflare`. SDK
  signature change: `registerDomain(apiKey, orgId, domain, { years?,
  registrant })` instead of `registerDomain(..., years?)`.
- **People / Company / Audience Goldfox schema overhaul.** Filter
  dimensions reshaped: confidence tiers (`high | low | very_low`),
  behavioral signals (`has_c_level`, `has_careers_page`,
  `has_decision_maker`, etc.), link-confidence threshold. Old
  industry/seniority/function dimensions are gone.

### Demoted to preview

The following skills are now `status: 'preview'` in `services.ts` (their
backend routes return `503 SERVICE_NOT_LAUNCHED` pre-launch). CLI commands
remain wired so existing scripts get a clean error message; skills are no
longer bundled with the CLI install.

- `my-email-api` (mailbox / message / template / campaign / warmup — email
  *verify* remains GA as a sibling skill)
- `my-people-api` (Goldfox-backed people search/get)
- `my-company-api` (Goldfox-backed company search/get)
- `my-audience-api` (saved filter snapshots)
- `my-url-to` (already preview before this release)

### Deprecated

- `myapi auth install-skills` still works but prints a deprecation warning
  to stderr. **It will be removed in 1.3.0.** Migrate to
  `myapi install-skills`.

### Removed

- `packages/mcp/` — the MCP server package has been removed. Empirically,
  agents (Claude / Gemini) prefer the CLI shell-out path over MCP tool
  invocations for these primitives. The skill bundle remains the discovery
  surface.

### Fixed

- Tab completion now works on partial subcommands (`myapi crm c<TAB>`
  used to return nothing).
- Whoami rendering for the free-tier field (backend returns an array, SDK
  had the wrong type).
- `myapi billing topup` no longer hangs in non-interactive contexts when
  confirmation would otherwise prompt — fails fast with a clear "pass
  `--yes`" hint.
- `myapi workflow --help` no longer shows the wrong subcommand list.
- Storage local-upload accepts `.mp4` / `.webm` (was image-only).

### Licensing

- **Relicensed from MIT to Apache-2.0.** `LICENSE` updated; every published
  `package.json` carries `"license": "Apache-2.0"`. Bring-your-own-code
  contributions are unchanged in spirit; the explicit patent grant in
  Apache-2.0 is the only material difference.

## [1.1.0] — Unreleased

*Planned milestone — never shipped to npm. The 1.2.0 release supersedes it.
Originally scoped: initial public stable release covering email, webhook,
workflow, image, storage, pixel, and url services with CLI v2 refactor,
strict flag validation, positional-arg convention, and online integration
test suite. All of that is included in 1.2.0.*

[Unreleased]: https://github.com/myapihq/myapi-integrations/compare/v1.2.5...HEAD
[1.2.5]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.5
[1.2.4]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.4
[1.2.3]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.3
[1.2.2]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.2
[1.2.1]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.1
[1.2.0]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.2.0
[1.1.0]: https://github.com/myapihq/myapi-integrations/releases/tag/v1.1.0
