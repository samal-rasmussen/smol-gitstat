# smol-gitstat

This tool generates a JSON logfile of a git repository, intended to be used on gitstat.com.

## How to Use

Run it in a git repository:

```sh
npx smol-gitstat
```

It writes `gitstat_result.json` to the current working directory, with the project name set to the repository folder name. Then it serves the gitstat web frontend on http://127.0.0.1:7070 with that data loaded and opens it in your browser. Press Ctrl+C to stop the server. Everything runs locally, so nothing is uploaded anywhere.

To only generate the JSON, pass `--no-serve`.

### Flags

-   `-o, --out <path>`: write output JSON to a file at `<path>` (default: `gitstat_result.json`)
-   `--stdout`: write output JSON to stdout instead of a file. Does not serve.
-   `--author-date`: use the author date as the commit date. gitstat.com graphs commits by commit date, which for long-lived branches reflects when the branch was merged rather than when the work was done. Author dates preserve when the work actually happened.
-   `--no-serve`: only write the JSON file; do not start the web frontend
-   `--no-open`: start the web frontend but do not open the browser
-   `-p, --port <n>`: port to serve on (default: 7070, or the next free port after it when it is taken). The frontend keeps its settings (aliases, filters) per port, so a fixed port keeps them between runs.
-   `-h, --help`: show help
