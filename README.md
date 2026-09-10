# smol-gitstat

This tool generates a JSON logfile of a git repository, intended to be used on gitstat.com.

## How to Use

Run it in a git repository:

```sh
npx smol-gitstat
```

By default it writes `gitstat_result.json` to the current working directory, and sets the project name to the repository folder name.

### Flags

-   `-o, --out <path>`: write output JSON to a file at `<path>` (default: `gitstat_result.json`)
-   `--stdout`: write output JSON to stdout instead of a file
-   `--author-date`: use the author date as the commit date. gitstat.com graphs commits by commit date, which for long-lived branches reflects when the branch was merged rather than when the work was done. Author dates preserve when the work actually happened.
-   `-h, --help`: show help
