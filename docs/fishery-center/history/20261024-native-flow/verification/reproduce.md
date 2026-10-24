# Reproduce isolated verification

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


All paths below belong to task 5. Do not point these commands at a business database. The official Node archive and PostgreSQL build remain under `tmp/`; their checksum/build evidence is in this directory.

```sh
TASK5_ROOT=[private-local-path]
export PATH="$TASK5_ROOT[temporary-evidence-path]"
export PLAYWRIGHT_BROWSERS_PATH="$TASK5_ROOT[temporary-evidence-path]"
cd "$TASK5_ROOT/implementation"
pg_ctl -D "$TASK5_ROOT[temporary-evidence-path]" -l "$TASK5_ROOT/verification/postgres-server.log" -o "-h 127.0.0.1 -p 55445 -k $TASK5_ROOT[temporary-evidence-path]" start
npm run typecheck
npm run build -w @aihot/web
DATABASE_URL=postgres://task5_test@127.0.0.1:55445/native_integration_test npm test
node --test --test-timeout=120000 apps/web/tests/*.test.ts modules/fishery/web/tests/reader.browser.ts
```

Build before running backend or browser suites, and keep the build stable until all suites finish: `tests/page-metadata.standalone.test.ts` also launches the built web server. Do not run another full suite against the same template database concurrently.

The smoke database `native_smoke_test` is migrated and empty. In one terminal, start only the local API with synthetic auth values and external actions disabled:

```sh
DATABASE_URL=postgres://task5_test@127.0.0.1:55445/native_smoke_test API_PORT=3106 SITE_URL=http://127.0.0.1:3105 AIHOT_CREDENTIALS_DIR=/nonexistent-test-credentials AIHOT_DATA_DIR="$TASK5_ROOT[temporary-evidence-path]" SESSION_SECRET=<synthetic-test-value-omitted> IMG_PROXY_SIGN_SECRET=<synthetic-test-value-omitted> COLLECT_ENABLED=false MODEL_CALLS_ENABLED=false FEISHU_CONTENT_PUSH_ENABLED=false INDEXNOW_SUBMIT_ENABLED=false node apps/api/src/main.ts
```

In another terminal with the same PATH and implementation working directory:

```sh
WEB_PORT=3105 API_BASE_URL=http://127.0.0.1:3106 SITE_URL=http://127.0.0.1:3105 PRIVATE_PREVIEW=true node apps/web/server.ts
```

Then run:

```sh
node scripts/smoke.ts --base http://127.0.0.1:3105
```

No worker is needed for this empty-database smoke check. Stop those two task-local servers with Ctrl-C after checking, then stop this isolated cluster:

```sh
pg_ctl -D "$TASK5_ROOT[temporary-evidence-path]" -m fast stop
```

Sandbox localhost/shared-memory restrictions may require the execution tool's normal approval flow. No system installation, real provider key, `.env`, production database, or production service is needed.
