# Task 5 verification environment

> Archived project snapshot; dates and claims describe that stage, not current live state. Local paths and private deployment locations are redacted. Local-only evidence is catalogued in provenance; its links are not copies of the raw evidence. See [current status](../../../current-status.md) and [source/hash inventory](../../../provenance/source-manifest.json).


- Initial Node: `/opt/homebrew/bin/node`, v26.5.0; npm 11.17.0. Final supported runtime: task-5[temporary-evidence-path] v24.14.1; official archive SHA256 verified (node24-checksum.log). Node 26 caused a reproduced pre-existing TLS ServerName/IP incompatibility, resolved by the supported runtime without changing egress code.
- Repository: `implementation`, based on a5a0f8c064d5c82a707af2f170582338bb8ff10e.
- package-lock SHA256: 631cf6bb0b5f11795aa098586ebb040b80cf5efac69c77470ab1c5de5d20155d, identical to task-4/integration.
- Dependencies copied to local physical files. Eight workspace symlinks target implementation; 231 external links materialized. Two backend nested packages copied separately (entities 8.1.0, undici 8.11.2). No lock or dependency manifest changes.
- PostgreSQL 17.6 official source: https://ftp.postgresql.org/pub/source/v17.6/postgresql-17.6.tar.bz2 . Official adjacent SHA256 verified. All build/install/data files stay under task-5/tmp. Build includes lz4, zlib and pg_trgm. A compressed custom dump and pg_restore listing succeeded.
- Isolated database: loopback 127.0.0.1:55445, local test-only role task5_test, cluster task-5[temporary-evidence-path] No business database or .env loaded.
- Full-suite template reserved by verification owner: native_integration_test. Each owner uses a distinct *_test template.
- Sandbox blocks localhost networking/shared memory. Database/HTTP tests require tool approval; source download and isolated PG startup approved.

Command pattern (implementation cwd):

```
PATH=[private-local-path] DATABASE_URL=postgres://task5_test@127.0.0.1:55445/native_integration_test npm test
```

Tests themselves enforce *_test/*_ci and local fake providers. External push valves stay off. Initial baseline failures before complete environment are recorded separately and are not product regressions.

Browser cache: task-5[temporary-evidence-path] Locked WebKit 2311/FFmpeg 1011 downloaded, Chromium 1228/headless shell 1228 linked read-only to existing cache. Set PLAYWRIGHT_BROWSERS_PATH to this directory. No dependency lock or browser test was weakened.
