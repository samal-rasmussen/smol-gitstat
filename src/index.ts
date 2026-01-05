#!/usr/bin/env node

import { spawn } from "child_process";
import { splitStream } from "@simple-libs/stream-utils";
import { outputStream } from "@simple-libs/child-process-utils";

type Arg = string | false | null | undefined;
const SCISSOR = "------------------------ >8 ------------------------";

type FileChange = {
	filepath: string;
	isBinary: false;
	additions: number;
	deletions: number;
	rawAdditions: number;
	rawDeletions: number;
};

type Commit = {
	hash: string;
	author: { name: string; time: string };
	committer: { name: string; time: string };
	message: string;
	files: FileChange[];
	isMerge: boolean;
};

async function* getCommits() {
	const args: Arg[] = [
		"log",
		`--numstat`,
		`--format=${SCISSOR}%nhash: %H%nparents: %P%nsubject: %s%nauthor name: %an%nauthor date: %aI%ncommitter name: %cn%ncommitter date: %cI`,
	];
	const stdout = outputStream(
		spawn("git", args.filter(Boolean) as string[], {
			cwd: process.cwd(),
		}),
	);
	const commitsStream = splitStream(stdout, `${SCISSOR}\n`);
	let chunk: string;

	for await (chunk of commitsStream) {
		chunk = chunk.trim();
		if (!chunk) continue;
		yield chunk;
	}
}

function parseNumstatLine(line: string): FileChange | null {
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

function parseCommitChunk(chunk: string): Commit {
	let hash = "";
	let parentsLine = "";
	let subject = "";
	let authorName = "";
	let authorTime = "";
	let committerName = "";
	let committerTime = "";
	const files: FileChange[] = [];

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
	let first = true;
	process.stdout.write(`{
  "version": "1.0.0",
  "projects": [
    {
      "name": "bokin-fo",
      "commits": [
`);

	for await (const chunk of getCommits()) {
		const commit = parseCommitChunk(chunk);
		process.stdout.write(`${first ? "" : ",\n"}${JSON.stringify(commit, null, 2)}`);
		first = false;
	}

	process.stdout.write("\n      ]\n    }\n  ]\n}\n");
}

main();
