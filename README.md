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
-   `-h, --help`: show help
