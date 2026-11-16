# Maintenance log

Started 2026-11-16 on `maintenance/stability-fixes` from `01dfecb`.

## Baseline

Working tree was clean. TypeScript checking, Go builds, and Go vet passed in both Go modules. The repository has no checked-in test suites or lint script. Focused regression probes run against the actual source without adding dependencies or test scaffolding to the repository. Desktop playback and visual interaction checks have not run in this maintenance pass.

## Preserve library during metadata migration failures

Confirmed that a storage-write failure while migrating added dates caused the library loader to return empty liked songs and playlists. The original stored library remained present, creating a risk that subsequent edits would replace it with the empty state.

Separated the migration-write failure from library parsing. Valid songs remain available and the existing snackbar receives an honest storage error. Importing collections uses the same error reporting.

Verification: reproduced zero liked songs and playlists before the fix using a throwing storage writer. Source-level regression probes now preserve the song, playlist, and original storage, report the failure, persist a successful migration once, and retain the malformed-JSON fallback. `npm run typecheck` passed.

Commit and push status will be recorded at the next checkpoint.
