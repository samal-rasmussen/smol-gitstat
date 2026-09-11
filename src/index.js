#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { splitStream } from "@simple-libs/stream-utils";
import { outputStream } from "@simple-libs/child-process-utils";
import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";

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

const SCISSOR = "------------------------ >8 ------------------------";

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
		`--format=${SCISSOR}%nhash: %H%nparents: %P%nsubject: %s%nauthor name: %an%nauthor date: %aI%ncommitter name: %cn%ncommitter date: %cI`,
	];
	const stdout = outputStream(
		spawn("git", args, {
			cwd: process.cwd(),
		}),
	);
	const commitsStream = splitStream(stdout, `${SCISSOR}\n`);
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
	/** @type {FileChange[]} */
	const files = [];

	for (const rawLine of chunk.split("\n")) {
		const line = rawLine.trimEnd();
		if (!line) continue;

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
	return {
		hash,
		author: { name: authorName, time: authorTime },
		committer: { name: committerName, time: committerTime },
		message: subject,
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

	for await (const chunk of getCommits()) {
		const commit = parseCommitChunk(chunk);
		if (cliOptions.authorDate) {
			commit.committer.time = commit.author.time;
		}
		output.write(`${first ? "" : ",\n"}${JSON.stringify(commit, null, 2)}`);
		first = false;
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
			`Wrote gitstat output to ${cliOptions.outPath} in ${formatDuration(durationMs)}.\n`,
		);
	}
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
		},
		strict: true,
		allowPositionals: false,
	});

	const help = Boolean(values.help);
	const stdout = Boolean(values.stdout);
	const authorDate = Boolean(values["author-date"]);
	const outPath = values.out ?? "gitstat_result.json";

	if (stdout && values.out != null) {
		throw new Error("Cannot use both --stdout and --out.");
	}

	return { help, stdout, authorDate, outPath };
}

/**
 * @returns {string}
 */
function getHelpText() {
	return `smol-gitstat

Usage:
  smol-gitstat [--out <path> | --stdout] [--author-date]

Options:
  -o, --out <path>  Write output to a file (default: gitstat_result.json)
      --stdout      Write output to stdout instead of a file
      --author-date Use the author date as the commit date. Useful for
                    long-lived branches, where commit dates reflect when the
                    branch was merged rather than when the work was done.
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
