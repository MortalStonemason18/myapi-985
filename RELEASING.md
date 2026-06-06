# Releasing

Versions across `packages/sdk` and `packages/cli` are kept in sync — they're
tightly coupled, and a CLI release usually requires the matching SDK on the
registry.

## CLI argument conventions

When a command takes one or more required arguments, the **first required arg
is positional** and the rest are flags. This is consistent across the CLI:

```
myapi org create <name>                 # not --name <name>
myapi webhook create <name>             # not --name <name>
myapi email mailbox create <user@domain>
myapi email template generate <name> --prompt "..."
myapi email campaign create <name> --template-id <id> --from <email>
myapi workflow create <name> --endpoint-id <id> --steps '...'
myapi domain register <domain>
myapi funnel get <id>
```

The flag form (`--name <x>`) is still accepted on `create` commands for
backwards compatibility, but the positional form is the documented shape.

## Stable release

Manual today:

```bash
# 1. Bump versions in both packages/<name>/package.json files together,
#    e.g. 1.0.84 → 1.1.0. Keep packages/cli's "@myapihq/sdk" dep set to "*"
#    for stable releases.
# 2. Build:
npm run build --workspace=packages/sdk && npm run build --workspace=packages/cli
# 3. Publish:
for p in sdk cli; do (cd packages/$p && npm publish --access public); done
```

## Prerelease / WIP

WIP releases don't trigger the auto-updater — it only polls the `latest`
dist-tag.

```bash
# 1. Bump to a prerelease version (e.g. 1.1.0-wip.0) in both packages.
#    For wip, pin packages/cli's "@myapihq/sdk" to the exact wip version
#    so installs of @wip pull the matching SDK.
# 2. Build (same as the stable flow above).
# 3. Publish with --tag wip:
for p in sdk cli; do (cd packages/$p && npm publish --access public --tag wip); done
# 4. Test:
npm install -g @myapihq/cli@wip
```

> **TODO:** automate the bump + dep-pin step. A short `scripts/bump.js` (~40
> lines) would take a target version and update both `package.json` files plus
> inter-package `@myapihq/*` deps in one go — eliminating the manual
> edit-two-files dance and the easy-to-forget dep pinning for prereleases.
> Until that lands, follow the steps above carefully.
