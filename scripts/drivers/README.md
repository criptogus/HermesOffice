# Real-app automation driver scripts (drivers)

Local Playwright/Electron acceptance scripts against the real app. **Not in CI, gitignored by default, never pushed.**

## Location

```
scripts/drivers/driver.<feature>.mjs
```

Driver scripts are local-only (gitignored — this directory ships empty except
for this README). Run one you have written locally with:

```bash
node scripts/drivers/driver.<name>.mjs
```

## Conventions

- Put new feature acceptance scripts here, named `driver.<feature>.mjs`
- Use `playwright-core`'s `_electron` to launch `apps/*`; screenshots usually go to `/tmp/...`
- Division of labor with `apps/*/tests` (vitest): unit tests run in CI; scripts here are for manual / on-demand real-app acceptance
- Do not put `driver.*.mjs` files in the repo root

When plan docs mention a driver, write the full path `scripts/drivers/driver.xxx.mjs`.
