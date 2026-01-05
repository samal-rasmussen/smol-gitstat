#!/usr/bin/env node

import { spawn, spawnSync } from "child_process";
import { splitStream } from "@simple-libs/stream-utils";
import { outputStream } from "@simple-libs/child-process-utils";
import fs from "fs";
import path from "path";
import { parseArgs } from "node:util";

/**
 * @typedef {string | false | null | undefined} Arg
 */

/**
 * @typedef {Object} FileChange
 * @property {string} filepath
 * @property {false} isBinary
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
	/** @type {Arg[]} */
	const args = [
		"log",
		`--numstat`,
		`--format=${SCISSOR}%nhash: %H%nparents: %P%nsubject: %s%nauthor name: %an%nauthor date: %aI%ncommitter name: %cn%ncommitter date: %cI`,
	];
	const stdout = outputStream(
		spawn("git", args.filter(Boolean), {
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

	const additions = additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw, 10);
	const deletions = deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw, 10);
	if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;

	return {
		filepath,
		isBinary: false,
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
	const cliOptions = parseCliOptions();
	if (cliOptions.help) {
		process.stdout.write(getHelpText());
		return;
	}

	const output = cliOptions.stdout
		? process.stdout
		: fs.createWriteStream(cliOptions.outPath);
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
		output.write(`${first ? "" : ",\n"}${JSON.stringify(commit, null, 2)}`);
		first = false;
	}

	output.write("\n      ]\n    }\n  ]\n}\n");
	if (!cliOptions.stdout) {
		await new Promise((resolve, reject) => {
			output.on("finish", resolve);
			output.on("error", reject);
			output.end();
		});
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
		},
		strict: true,
		allowPositionals: false,
	});

	const help = Boolean(values.help);
	const stdout = Boolean(values.stdout);
	const outPath = values.out ?? "gitstat_result.json";

	if (stdout && values.out != null) {
		throw new Error("Cannot use both --stdout and --out.");
	}

	return { help, stdout, outPath };
}

/**
 * @returns {string}
 */
function getHelpText() {
	return `smol-gitstat

Usage:
  smol-gitstat [--out <path> | --stdout]

Options:
  -o, --out <path>  Write output to a file (default: gitstat_result.json)
      --stdout      Write output to stdout instead of a file
  -h, --help        Show this help
`;
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
