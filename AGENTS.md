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

## Layout

- `README.md` — user docs (usage and flags). Update it alongside `getHelpText()`.
- `src/index.js` — the entire program. It is the `main` entry and the
  `smol-gitstat` bin. Everything (git spawning, streaming, parsing, CLI
  parsing, output) lives here.
- `package.json` — `files` whitelists only `README.md`, `src/index.js`, and
  `LICENSE.md` for publishing. Adding a new source file means adding it here.
- `tsconfig.json` — type-checks the plain JS via JSDoc (`allowJs` +
  `checkJs`, `strict`, `noUncheckedIndexedAccess`). No emit; `dist/` is unused.

## Conventions

- Plain ESM JavaScript (`"type": "module"`), no build step, no transpiling.
  Types are JSDoc `@typedef` / `@param` / `@returns` comments and must satisfy
  `tsc --noEmit`.
- Requires Node >= 24. Only Node built-ins plus two small deps:
  `@simple-libs/stream-utils` (`splitStream`) and
  `@simple-libs/child-process-utils` (`outputStream`).
- Tabs for indentation, double quotes, semicolons.
- CLI flags are parsed with `node:util` `parseArgs` in strict mode; unknown
  flags throw. Keep `getHelpText()` and the README flags list in sync when
  changing options.
- Errors are printed to stderr and set `process.exitCode = 1`; do not
  `process.exit()` mid-stream.

## Working in the repo

```sh
npm install          # installs typescript + the two runtime deps
npm run check        # tsc --noEmit — the only test/lint gate; run before committing
node src/index.js    # run against the current repo, writes gitstat_result.json
node src/index.js -o /tmp/out.json && head -30 /tmp/out.json   # inspect output shape
```

There is no test suite. Verify changes by running the script against this repo
(or a larger one) and inspecting the JSON, and by running `npm run check`.

## Publishing

`npm run release` runs the type check and then `npm publish --access public`
against registry.npmjs.org. Bump `version` in `package.json` first.
