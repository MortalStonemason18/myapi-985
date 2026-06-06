# Service TODOs

## Drive-by items (surfaced 2026-05-11 strategic session)

- [ ] **`myapi whoami` FreeTier rendering bug.** Backend returns `free_tier` as an array of `{service, used, allowance}` per-service entries, but the SDK type for `getFreeTier` claims a scalar `{used, limit, remaining}` shape — and whoami renders against the wrong shape, producing `"FreeTier: undefined/undefined used (undefined remaining)"`. `myapi status` already handles the array shape correctly; the fix is to (a) update the SDK type, (b) update whoami to render per-service like status does. Small but visible.
- [ ] **Storage local-upload extension for video.** Backend accepts `video/mp4` and `video/webm` (up to 200MB) — verified in `myapi-hq/backend/internal/routes/org/org.go:666`. CLI/SDK `upload` is artificially restricted to `image/*` only. 5-line change: extend `UploadContentType` in `packages/sdk/src/storage.ts` + `EXT_TO_CT` in `packages/cli/src/commands/storage.ts` to include `.mp4` and `.webm`. Customer video flow currently has to go through `ingest` (URL-based) — this unblocks local-file flow.

---

## Pixel — integration gaps (surfaced 2026-05-11)

The pixel ingestion pipeline is real and live in prod (`https://cdn.myapihq.com/cdn/fp.js?dpid=<X>` returns the HyperFingerprint v2 script; backend ownership check at `myapi-hq/backend/internal/routes/pixel/pixel.go:98`). But the integration layer doesn't expose enough of it for agents or users to actually wire pixel tracking onto a funnel end-to-end. Four discrete gaps:

### Gap 1 — No CLI to mint or fetch a `dpid` (this repo)
- [ ] Add `myapi pixel embed <funnel-id-or-domain>` that prints the `<script src="https://cdn.myapihq.com/cdn/fp.js?dpid=<X>">` tag with the correct dpid. Need backend confirmation of where dpid comes from — auto-generated on domain register/assign? On funnel create? Stored where? Until this lands, users have no documented way to assemble the snippet, which makes the whole pixel surface effectively invisible.

### Gap 2 — `funnel push` doesn't auto-inject the pixel snippet (this repo)
- [ ] When pushing HTML to a funnel page, auto-inject the pixel `<script>` tag for the funnel's dpid before the closing `</body>` (with an `--no-pixel` opt-out). Currently if the agent or user forgets to add the tag, attribution is silently broken — the brainstorm flagged this as failure mode #7 ("agent forgets the pixel → no attribution at all"). Auto-injection makes the failure structurally impossible.

### Gap 3 — No `my-pixel-api` skill (this repo)
- [ ] Ship `skills/my-pixel-api/` mirroring the pattern from the other 11 skills (SKILL.md + README.md + plugin.json). Without it, agents won't auto-discover the pixel CLI surface; the 5 CLI subcommands (`visits`, `events`, `interactions`, `identity`, `audience`) might as well not exist for agent flows. Skill should cover the canonical recipe: embed snippet → visitor lands → query visits/events.

### Gap 4 — Pixel ownership check rejects preview subdomains (backend, myapi-hq)
- [ ] `verifyDomainOwnership` (`backend/internal/routes/pixel/pixel.go:98`) only matches against `funnel.domain` (assigned custom domain) and `domains` table. It does NOT recognize the auto-generated preview subdomain (`<slug>.makeautonomous.com`). As a result, querying pixel data for ANY preview-only funnel fails with `domain not owned by organization`. This blocks the agent-builds-a-SaaS demo path entirely (no custom domain at v1 → no pixel testability). Fix: add a third clause to the ownership query that splits the host on `.makeautonomous.com` and matches against `funnel.subdomain` (or whatever the schema field is called) for the org.

---

## Webhook — DONE ✅

- SDK: correct routes (`/webhook/orgs/{org_id}/endpoints`, `/webhook/deliveries/{id}`)
- SDK: correct types (`url`, `received_at` — no stale `inbound_url`/`headers`)
- CLI: `webhook` command wired into index (`list`, `create`, `delete`, `delivery`); `create --json` works; help documents delivery_id discovery
- Skill: `skills/my-webhook-api/SKILL.md` published; host references corrected to `api.mywebhookapi.com`; delivery_id flow documented
- Live smoke: all 4 CLI commands exercised end-to-end against prod backend (create → POST → delivery → delete)

Backlog (not blocking):
- [ ] Backend bug: `POST /webhook/orgs/{org_id}/endpoints` returns `created_at: "0001-01-01T00:00:00Z"` in the response body. The value is correct in `list`, just missing in `create`.

---

## Email (`feat/email-webhook-workflow`)

### Backend refactor needed (myapi-hq)
- [ ] Split email routes into two groups:
  - **Account-scoped** (drop `org_id` from URL): mailboxes, activate-sending, send, sent, inbox, outbox, message, status, warmup
  - **Org-scoped** (keep `/orgs/{org_id}/`): templates, campaigns
- [ ] `AssignDomain`: block unassign if active/paused campaigns exist with a `from_address` on that domain — return `DOMAIN_IN_USE` with list of affected campaigns

### SDK (`packages/sdk/src/email.ts`)
- [ ] Add `getTemplate(apiKey, orgId, templateId)` — backend route exists (`GET /email/orgs/{org_id}/templates/{id}`), SDK missing
- [ ] Add `uploadContactsFile(apiKey, orgId, campaignId, file)` — backend route exists (`POST .../contacts/upload-file`), SDK missing
- [ ] Update URLs once backend routes are refactored (remove `orgId` param from account-scoped functions)

### CLI (`packages/cli/src/commands/email.ts` + `index.ts`)
- [ ] Wire `emailCmd` into `index.ts` (currently not wired in — command is built but unreachable)
- [ ] Add missing subcommands:
  - `activate-sending`
  - `get-message`
  - `get-status`
  - `create-campaign`
  - `start-campaign`
  - `pause-campaign`
  - `resume-campaign`
  - `upload-contacts`
  - `get-campaign`
  - `update-campaign`
  - `warmup` (with start/pause/resume/stop/stats sub-subcommands)
- [ ] Add `email` to help text in `index.ts`
- [ ] Update URLs/params once backend routes are refactored

### Skill
- [ ] Add skill (`skills/my-email-api/SKILL.md`) once CLI is confirmed working

---

## Workflow (`feat/email-webhook-workflow`)

Backend routes already exist (`backend/internal/routes/workflow/{crud,execute}.go`, registered in `cmd/server/main.go:226-235`):
- `POST   /workflow/orgs/{org_id}/workflows`
- `GET    /workflow/orgs/{org_id}/workflows`
- `GET    /workflow/orgs/{org_id}/workflows/{id}`
- `PATCH  /workflow/orgs/{org_id}/workflows/{id}`
- `DELETE /workflow/orgs/{org_id}/workflows/{id}`
- `POST   /workflow/orgs/{org_id}/workflows/{id}/enable`
- `POST   /workflow/orgs/{org_id}/workflows/{id}/disable`
- `GET    /workflow/orgs/{org_id}/workflows/{id}/runs`
- `GET    /workflow/orgs/{org_id}/runs/{id}`

Step types supported by `execute.go`: `send_email` (from / to / subject / template_id|html, with `{{payload.field}}` interpolation, billed 1¢, injects tracking pixel + click redirectors) and `slack_message` (webhook_url / text). Trigger is webhook-based: `trigger_config.endpoint_id` links a workflow to a `my-webhook-api` endpoint. Runs retry up to 3 attempts (0s, 5s, 30s).

### Done ✅
- SDK: `Workflow` type fixed — `enabled: boolean` + `trigger_type` + `updated_at` (matches backend); JSDoc on `WorkflowStep` documents `{{payload.x}}` interpolation, mailbox-activation requirement, billing, and tracking injection.
- CLI: `workflow` command wired into `index.ts` (import, switch case, `help workflow` branch, `printHelp` row); added subcommands `get`, `update`, `get-run`; `create` accepts `--no-enable`; `list` and `runs` show clean summary tables with full data behind `--json`.

### Pending
- [ ] End-to-end smoke against live backend: webhook endpoint → workflow with `send_email` step → POST to inbound URL → verify run is `completed` and email lands.
- [ ] Same with `slack_message` step pointing at a throwaway Slack webhook.
- [ ] Negative test: disabled workflow does not produce a run when its endpoint receives a delivery.
- [ ] Add skill (`skills/my-workflow-api/SKILL.md`) once CLI is confirmed working against live backend. Should cover the canonical recipe: create webhook endpoint → create workflow with `trigger_config.endpoint_id` → POST sample payload to endpoint URL → check `workflow runs <id>` for the resulting run. Document the two step types and the `{{payload.x}}` interpolation rules.
