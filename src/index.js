#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { splitStream } from "@simple-libs/stream-utils";
import { outputStream } from "@simple-libs/child-process-utils";
import fs from "fs";
import path from "path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sirv from "sirv";

/**
 * @typedef {Object} FileChange
 * @property {string} filepath
 * @property {string} [renameOf] The previous path, when git detected a rename
 * @property {boolean} isBinary
 * @property {number} additions
 * @property {number} deletions
 * @property {number} rawAdditions
 * @property {number} rawDeletions
 */

/**
 * @typedef {Object} Commit
 * @property {string} hash
 * @property {{ name: string, time: string }} author
 * @property {{ name: string, time: string }} committer
 * @property {string} message
 * @property {FileChange[]} files
 * @property {boolean} isMerge
 */

const COMMIT_SEPARATOR = "------------------------ commit separator ------------------------";
const BODY_END = "------------------------ body end ------------------------";

const DEFAULT_PORT = 7070;
/** How many ports after the default to try when it is taken. */
const PORT_ATTEMPTS = 10;
/** The URL path the generated JSON is served at, next to the web frontend. */
const DATA_URL_PATH = "/gitstat_result.json";
const WEB_DIR = fileURLToPath(new URL("../web", import.meta.url));

async function* getCommits() {
	/** @type {string[]} */
	const args = [
		// Without this git escapes non-ASCII paths as quoted octal sequences.
		"-c",
		"core.quotePath=false",
		"log",
		// Detect renames regardless of the user's diff.renames config.
		`--find-renames`,
		`--numstat`,
		`--format=${COMMIT_SEPARATOR}%nhash: %H%nparents: %P%nsubject: %s%nauthor name: %an%nauthor date: %aI%ncommitter name: %cn%ncommitter date: %cI%nbody:%n%b%n${BODY_END}`,
	];
	const stdout = outputStream(
		spawn("git", args, {
			cwd: process.cwd(),
		}),
	);
	const commitsStream = splitStream(stdout, `${COMMIT_SEPARATOR}\n`);
	/** @type {string} */
	let chunk;

	for await (chunk of commitsStream) {
		chunk = chunk.trim();
		if (!chunk) continue;
		yield chunk;
	}
}

/**
 * Splits a rename path as printed by git numstat, either `old => new` or
 * `prefix{old => new}suffix`, into the old and new paths.
 *
 * @param {string} filepath
 * @returns {{ renameOf: string, filepath: string } | null}
 */
function parseRenamePath(filepath) {
	const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(filepath);
	if (braces) {
		const [, prefix = "", oldPart, newPart, suffix = ""] = braces;
		return {
			renameOf: joinRenamePath(prefix, oldPart ?? "", suffix),
			filepath: joinRenamePath(prefix, newPart ?? "", suffix),
		};
	}

	const whole = /^(.*) => (.*)$/.exec(filepath);
	if (whole) {
		const [, renameOf = "", newPath = ""] = whole;
		return { renameOf, filepath: newPath };
	}

	return null;
}

/**
 * When the middle part is empty the prefix and suffix share the slash between
 * them, e.g. `x/{ => src}/file` means `x/file` was renamed to `x/src/file`.
 *
 * @param {string} prefix
 * @param {string} part
 * @param {string} suffix
 * @returns {string}
 */
function joinRenamePath(prefix, part, suffix) {
	if (!part && prefix.endsWith("/") && suffix.startsWith("/")) {
		return prefix + suffix.slice(1);
	}
	return prefix + part + suffix;
}

/**
 * @param {string} line
 * @returns {FileChange | null}
 */
function parseNumstatLine(line) {
	const tabSplit = line.split("\t");
	const parts =
		tabSplit.length >= 3
			? [tabSplit[0] ?? "", tabSplit[1] ?? "", tabSplit.slice(2).join("\t")]
			: null;

	const match = parts ? null : /^(\S+)\s+(\S+)\s+(.+)$/.exec(line);
	const additionsRaw = parts ? parts[0] : match?.[1];
	const deletionsRaw = parts ? parts[1] : match?.[2];
	const filepath = parts ? parts[2] : match?.[3];

	if (!additionsRaw || !deletionsRaw || !filepath) return null;

	// Git prints "-" for both counts of a binary file.
	const isBinary = additionsRaw === "-" && deletionsRaw === "-";
	const additions = isBinary ? 0 : Number.parseInt(additionsRaw, 10);
	const deletions = isBinary ? 0 : Number.parseInt(deletionsRaw, 10);
	if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;

	const rename = parseRenamePath(filepath);
	return {
		filepath: rename ? rename.filepath : filepath,
		...(rename ? { renameOf: rename.renameOf } : {}),
		isBinary,
		additions,
		deletions,
		rawAdditions: additions,
		rawDeletions: deletions,
	};
}

/**
 * @param {string} chunk
 * @returns {Commit}
 */
function parseCommitChunk(chunk) {
	let hash = "";
	let parentsLine = "";
	let subject = "";
	let authorName = "";
	let authorTime = "";
	let committerName = "";
	let committerTime = "";
	/** @type {string[]} */
	const bodyLines = [];
	let inBody = false;
	/** @type {FileChange[]} */
	const files = [];

	for (const rawLine of chunk.split("\n")) {
		// The body is free text and may contain lines that look like headers or
		// numstat lines, so it is delimited and copied verbatim.
		if (inBody) {
			if (rawLine === BODY_END) {
				inBody = false;
			} else {
				bodyLines.push(rawLine);
			}
			continue;
		}

		const line = rawLine.trimEnd();
		if (!line) continue;

		if (line === "body:") {
			inBody = true;
			continue;
		}

		if (line.startsWith("hash:")) {
			hash = line.slice("hash:".length).trim();
			continue;
		}
		if (line.startsWith("parents:")) {
			parentsLine = line.slice("parents:".length).trim();
			continue;
		}
		if (line.startsWith("subject:")) {
			subject = line.slice("subject:".length).trim();
			continue;
		}
		if (line.startsWith("author name:")) {
			authorName = line.slice("author name:".length).trim();
			continue;
		}
		if (line.startsWith("author date:")) {
			authorTime = line.slice("author date:".length).trim();
			continue;
		}
		if (line.startsWith("committer name:")) {
			committerName = line.slice("committer name:".length).trim();
			continue;
		}
		if (line.startsWith("committer date:")) {
			committerTime = line.slice("committer date:".length).trim();
			continue;
		}

		const fileChange = parseNumstatLine(line);
		if (fileChange) files.push(fileChange);
	}

	const parents = parentsLine.split(/\s+/).filter(Boolean);
	const body = bodyLines.join("\n").trim();
	return {
		hash,
		author: { name: authorName, time: authorTime },
		committer: { name: committerName, time: committerTime },
		message: body ? `${subject}\n\n${body}` : subject,
		files,
		isMerge: parents.length > 1,
	};
}

async function main() {
	const startTime = Date.now();
	const cliOptions = parseCliOptions();
	if (cliOptions.help) {
		process.stdout.write(getHelpText());
		return;
	}

	/** @type {NodeJS.WritableStream} */
	const output = cliOptions.stdout ? process.stdout : fs.createWriteStream(cliOptions.outPath);
	const repoName = getRepoName();
	let first = true;
	output.write(`{
  "version": "1.0.0",
  "projects": [
    {
      "name": "${repoName}",
      "commits": [
`);

	const progress = createProgress();
	let commitCount = 0;
	progress.update("Reading commits…");
	try {
		for await (const chunk of getCommits()) {
			const commit = parseCommitChunk(chunk);
			if (cliOptions.authorDate) {
				commit.committer.time = commit.author.time;
			}
			output.write(`${first ? "" : ",\n"}${JSON.stringify(commit, null, 2)}`);
			first = false;
			commitCount++;
			progress.update(`Reading commits… ${commitCount.toLocaleString("en-US")}`);
		}
	} finally {
		// Also on failure, so an error message starts on a clean line.
		progress.clear();
	}

	output.write("\n      ]\n    }\n  ]\n}\n");
	if (!cliOptions.stdout) {
		await new Promise((resolve, reject) => {
			output.once("finish", () => resolve(undefined));
			output.once("error", reject);
			output.end();
		});
		const durationMs = Date.now() - startTime;
		process.stderr.write(
			`Wrote ${commitCount.toLocaleString("en-US")} commits to ${cliOptions.outPath} in ${formatDuration(durationMs)}.\n`,
		);
		if (cliOptions.serve) {
			await serve(cliOptions);
		}
	}
}

/** How often the progress line is redrawn. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * A single status line on stderr, redrawn in place. Does nothing when stderr
 * is not a terminal, so logs and pipes stay clean. Redraws are throttled;
 * the latest text is kept so a skipped update is not lost for long.
 *
 * @returns {{ update(text: string): void, clear(): void }}
 */
function createProgress() {
	const stream = process.stderr;
	if (!stream.isTTY) {
		return { update() {}, clear() {} };
	}
	let lastDraw = 0;
	let drawn = false;
	return {
		update(text) {
			const now = Date.now();
			if (drawn && now - lastDraw < PROGRESS_INTERVAL_MS) return;
			lastDraw = now;
			drawn = true;
			stream.write(`\r\x1b[K${text}`);
		},
		clear() {
			if (drawn) stream.write("\r\x1b[K");
			drawn = false;
		},
	};
}

/**
 * Serves the web frontend and the generated JSON on localhost. The page is
 * opened with `?data=` pointing at the JSON, which makes the frontend load it
 * on boot. Keeps running until the process is interrupted.
 *
 * @param {CliOptions} cliOptions
 * @returns {Promise<void>}
 */
async function serve(cliOptions) {
	const dataPath = path.resolve(cliOptions.outPath);
	// Dev mode looks files up per request instead of crawling the folder up
	// front, and sends no-store so a newer package version is never stale.
	const assets = sirv(WEB_DIR, { dev: true });
	const server = createServer((req, res) => {
		const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
		if (pathname !== DATA_URL_PATH) {
			assets(req, res);
			return;
		}
		fs.stat(dataPath, (error, stats) => {
			if (error) {
				res.writeHead(404).end();
				return;
			}
			res.writeHead(200, {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Length": stats.size,
				"Cache-Control": "no-store",
			});
			fs.createReadStream(dataPath).pipe(res);
		});
	});

	const port = await listen(server, cliOptions.port);
	const url = `http://127.0.0.1:${port}/?data=${DATA_URL_PATH.slice(1)}#/graphs`;
	process.stderr.write(`Serving the gitstat web frontend at ${url}\nPress Ctrl+C to stop.\n`);
	if (cliOptions.open) {
		openBrowser(url);
	}
}

/**
 * Starts listening on 127.0.0.1. With no explicit port, tries the default and
 * the next few ports after it when they are taken.
 *
 * @param {import("node:http").Server} server
 * @param {number | null} port The port given with --port, if any
 * @returns {Promise<number>} The port listened on
 */
async function listen(server, port) {
	const candidates =
		port !== null
			? [port]
			: Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i);
	for (const candidate of candidates) {
		try {
			await new Promise((resolve, reject) => {
				server.once("error", reject);
				server.listen(candidate, "127.0.0.1", () => {
					server.off("error", reject);
					resolve(undefined);
				});
			});
			return candidate;
		} catch (error) {
			const code = /** @type {NodeJS.ErrnoException} */ (error).code;
			if (code !== "EADDRINUSE") throw error;
		}
	}
	throw new Error(
		port !== null
			? `Port ${port} is already in use.`
			: `Ports ${DEFAULT_PORT}-${DEFAULT_PORT + PORT_ATTEMPTS - 1} are all in use. Pick one with --port.`,
	);
}

/**
 * Opens a URL in the default browser. Failure is ignored; the URL has already
 * been printed.
 *
 * @param {string} url
 * @returns {void}
 */
function openBrowser(url) {
	/** @type {[string, string[]]} */
	const [command, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? // start takes its first quoted argument as the window title,
					// so give it an empty one.
					["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	const child = spawn(command, args, { stdio: "ignore", detached: true });
	child.on("error", () => {});
	child.unref();
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});

/**
 * @typedef {Object} CliOptions
 * @property {boolean} help
 * @property {boolean} stdout
 * @property {boolean} authorDate
 * @property {string} outPath
 * @property {boolean} serve
 * @property {boolean} open
 * @property {number | null} port
 */

/**
 * @returns {CliOptions}
 */
function parseCliOptions() {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			help: { type: "boolean", short: "h" },
			stdout: { type: "boolean" },
			out: { type: "string", short: "o" },
			"author-date": { type: "boolean" },
			serve: { type: "boolean", default: true },
			open: { type: "boolean", default: true },
			port: { type: "string", short: "p" },
		},
		strict: true,
		allowPositionals: false,
		allowNegative: true,
	});

	const help = Boolean(values.help);
	const stdout = Boolean(values.stdout);
	const authorDate = Boolean(values["author-date"]);
	const outPath = values.out ?? "gitstat_result.json";

	if (stdout && values.out != null) {
		throw new Error("Cannot use both --stdout and --out.");
	}

	// Writing to stdout is for piping the JSON elsewhere, so it never serves.
	const serve = !stdout && values.serve !== false;
	const open = values.open !== false;
	let port = null;
	if (values.port != null) {
		port = Number(values.port);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error(`Invalid --port: ${values.port}`);
		}
	}

	return { help, stdout, authorDate, outPath, serve, open, port };
}

/**
 * @returns {string}
 */
function getHelpText() {
	return `smol-gitstat

Generates gitstat_result.json from the current git repository, then serves
the gitstat web frontend on localhost with that data loaded and opens it in
the browser. Press Ctrl+C to stop the server.

Usage:
  smol-gitstat [--out <path> | --stdout] [--author-date]
               [--no-serve] [--no-open] [--port <n>]

Options:
  -o, --out <path>  Write output to a file (default: gitstat_result.json)
      --stdout      Write output to stdout instead of a file. Does not serve.
      --author-date Use the author date as the commit date. Useful for
                    long-lived branches, where commit dates reflect when the
                    branch was merged rather than when the work was done.
      --no-serve    Only write the file; do not start the web frontend
      --no-open     Serve, but do not open the browser
  -p, --port <n>    Port to serve on (default: ${DEFAULT_PORT}, or the next free
                    port after it). The frontend keeps its settings per port.
  -h, --help        Show this help
`;
}

/**
 * @param {number} durationMs
 * @returns {string}
 */
function formatDuration(durationMs) {
	if (durationMs < 1000) {
		return `${durationMs}ms`;
	}
	const seconds = durationMs / 1000;
	return `${seconds.toFixed(2)}s`;
}

/**
 * @returns {string}
 */
function getRepoName() {
	const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (result.status === 0 && result.stdout) {
		return path.basename(result.stdout.trim());
	}
	return path.basename(process.cwd());
}
