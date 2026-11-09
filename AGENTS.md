# smol-gitstat

A tiny Node CLI that turns a git repository's history into a JSON logfile for
[gitstat.com](https://gitstat.com). Published to npm as `smol-gitstat`; users run
it with `npx smol-gitstat` inside a repository. User-facing usage and flags are
documented in [README.md](README.md); this file is for people (and agents)
changing the code.

## What it does

1. Runs `git log --find-renames --numstat` with a custom `--format` that prints
   a commit separator line (`------------------------ >8 ------------------------`)
   followed by `hash:`, `parents:`, `subject:`, author/committer name and ISO
   date, a `body:` line, the commit body verbatim up to a body-end sentinel line,
   then the per-file `additions<TAB>deletions<TAB>path` numstat lines.
   Git is run with `core.quotePath=false` so non-ASCII paths are printed as-is
   instead of as quoted octal escapes.
2. Streams stdout and splits it on the commit separator line, so one chunk = one commit.
   The repo is never loaded into memory in full.
3. Parses each chunk into a `Commit` object (`hash`, `author`, `committer`,
   `message`, `files[]`, `isMerge`). `message` is the subject, and when the
   commit has a body, a blank line and the body. Binary files report `-` in numstat and are
   recorded with `isBinary: true` and 0 additions/deletions. Renames are printed
   by git as `old => new` or `prefix{old => new}suffix`; they are recorded with
   the new path as `filepath` and the old path as `renameOf`. `isMerge` is true
   when there is more than one parent.
4. Writes the result incrementally as
   `{ "version": "1.0.0", "projects": [{ "name": <repo folder name>, "commits": [...] }] }`
   to `gitstat_result.json` by default, or `--out <path>`, or `--stdout`.
   A timing message goes to stderr when writing to a file.
5. Unless `--stdout` or `--no-serve`, serves the web frontend in `web/` on
   127.0.0.1 using `sirv` with `node:http`, and opens the browser at
   `/?data=gitstat_result.json#/graphs`. `/gitstat_result.json` is a route
   that streams the file written in step 4 (wherever `--out` put it); every
   other path goes to sirv. The frontend's boot sees `?data=`, fetches and
   imports that URL, then drops the parameter. The default port is 7070,
   falling back to the next free one; an explicit `--port` that is taken is
   an error. The process stays alive until Ctrl+C.

## Layout

- `README.md` — user docs (usage and flags). Update it alongside `getHelpText()`.
- `src/index.js` — the entire CLI. It is the `main` entry and the
  `smol-gitstat` bin. Everything (git spawning, streaming, parsing, CLI
  parsing, output, serving) lives here.
- `web/` — the buildless web frontend, a separate project with its own
  `package.json`, checks and tests; see `web/AGENTS.md`. The CLI serves it
  as-is from the installed package.
- `package.json` — `files` whitelists `README.md`, `src/index.js`,
  `LICENSE.md` and the runtime parts of `web/` (`index.html`, `css`, `js`,
  `views`, `assets`, `vendor`, `LICENSE`) for publishing. Adding a new source
  file or web folder means adding it here; check with `npm pack --dry-run`.
- `tsconfig.json` — type-checks the plain JS via JSDoc (`allowJs` +
  `checkJs`, `strict`, `noUncheckedIndexedAccess`). No emit; `dist/` is unused.

## Conventions

- Plain ESM JavaScript (`"type": "module"`), no build step, no transpiling.
  Types are JSDoc `@typedef` / `@param` / `@returns` comments and must satisfy
  `tsc --noEmit`.
- Requires Node >= 24. Only Node built-ins plus three small deps:
  `@simple-libs/stream-utils` (`splitStream`),
  `@simple-libs/child-process-utils` (`outputStream`) and `sirv` (static
  file serving for the web frontend).
- Tabs for indentation, double quotes, semicolons.
- CLI flags are parsed with `node:util` `parseArgs` in strict mode; unknown
  flags throw. Keep `getHelpText()` and the README flags list in sync when
  changing options.
- Errors are printed to stderr and set `process.exitCode = 1`; do not
  `process.exit()` mid-stream.

## Working in the repo

```sh
npm install          # installs typescript + the runtime deps
npm run check        # tsc --noEmit — the CLI's only test/lint gate; run before committing
node src/index.js    # run against the current repo, writes gitstat_result.json and serves the frontend
node src/index.js --no-serve -o /tmp/out.json && head -30 /tmp/out.json   # inspect output shape
```

There is no test suite for the CLI. Verify changes by running the script
against this repo (or a larger one) and inspecting the JSON, and by running
`npm run check`. Changes under `web/` go through that project's own checks
(`cd web && npm run check && npm run lint && npm test && npm run test:e2e`).

## Publishing

`npm run release` runs the type check and then `npm publish --access public`
against registry.npmjs.org. Bump `version` in `package.json` first.
