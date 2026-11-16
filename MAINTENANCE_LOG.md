# Maintenance log

Started 2026-11-16 on `maintenance/stability-fixes` from `01dfecb`.

## Baseline

Working tree was clean. TypeScript checking, Go builds, and Go vet passed in both Go modules. The repository has no checked-in test suites or lint script. Focused regression probes run against the actual source without adding dependencies or test scaffolding to the repository. Desktop playback and visual interaction checks have not run in this maintenance pass.

## Preserve library during metadata migration failures

Confirmed that a storage-write failure while migrating added dates caused the library loader to return empty liked songs and playlists. The original stored library remained present, creating a risk that subsequent edits would replace it with the empty state.

Separated the migration-write failure from library parsing. Valid songs remain available and the existing snackbar receives an honest storage error. Importing collections uses the same error reporting.

Verification: reproduced zero liked songs and playlists before the fix using a throwing storage writer. Source-level regression probes now preserve the song, playlist, and original storage, report the failure, persist a successful migration once, and retain the malformed-JSON fallback. `npm run typecheck` passed.

Commit `392f71c` was pushed to `origin/maintenance/stability-fixes`.

## Preserve replacement snackbars during dismissal

Confirmed that a keyed progress message reused the previous notification ID while its exit timer remained active. Updating that notification during dismissal left the replacement invisible and then removed it.

Each update now receives a new notification ID while React keeps a stable slot identity. Replacement updates reset dismissal and drag state and cancel the old exit timer. The provider's ID check prevents stale removal callbacks from deleting newer messages.

Verification: a temporary DOM harness using the actual React components reproduced the replacement entering the leaving state and disappearing after 200 ms. After the fix the replacement remains visible, removal of another slot preserves its neighbor, and ordinary notifications still dismiss after six seconds plus the exit animation. `npm run typecheck` passed. The harness dependency was installed only under the OS temporary directory; repository dependencies are unchanged.

Commit and push status will be recorded at the next checkpoint.
