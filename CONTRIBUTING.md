# Contributing

Use Node.js 24 and `npm ci`, then run `npm run typecheck`, `npm run build`, and `npm test`.

The full suite runs serially with isolated data, no real API credentials, and local mock model servers. Do not run multiple copies simultaneously: some legacy tests use fixed loopback ports. On Linux CI the Electron download is skipped; desktop visual tests are currently verified on Windows separately.

For bug reports include the app version, OS, reproduction steps, expected/actual behavior and a minimal redacted example. Never include settings files, API keys or full private project data.

For changes, add a regression test first. Editing must preserve locked shots, original prose and version history; invalid model responses must not mutate the saved project. Avoid unrelated formatting changes.

Do not use a build command that deletes old releases automatically. Release binaries must be attached to GitHub Releases, not committed to the source repository.

The project owner must choose a license before accepting third-party contributions or describing the repository as open source.
