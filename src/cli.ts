#!/usr/bin/env node
// Thin CLI wrapper: `hono-svelte init` / `hono-svelte doctor`.
// Compiled to `dist/cli.js` and invoked via the `hono-svelte` bin.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { doctorChecks, checkAppLink, initFiles, isSafeAppPath } from "./scaffold.js";

const args = process.argv.slice(2);
const command = args[0];

function flagValue(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

const appRoot = flagValue("app") ?? process.cwd();

function init(): void {
  for (const file of initFiles()) {
    const dest = join(appRoot, file.path);
    if (!isSafeAppPath(appRoot, dest)) {
      console.error(`[hono-svelte] refusing to write outside ${appRoot}: ${file.path}`);
      process.exitCode = 1;
      continue;
    }
    if (file.skipIfExists && existsSync(dest)) {
      console.log(`[hono-svelte] exists, skipping: ${file.path}`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
    console.log(`[hono-svelte] wrote ${file.path}`);
  }
}

function packageRootForCli(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

function doctor(): void {
  const packageRoot = packageRootForCli();
  const issues = doctorChecks({ packageRoot, appRoot });
  const linkIssue = checkAppLink(appRoot);
  if (linkIssue) issues.push(linkIssue);
  if (issues.length === 0) {
    console.log("[hono-svelte] doctor: all good!");
    return;
  }
  for (const issue of issues) {
    console.log(`[hono-svelte] ${issue.code}: ${issue.message}`);
    console.log(`  fix: ${issue.fix}`);
  }
  process.exitCode = 1;
}

if (command === "init") init();
else if (command === "doctor") doctor();
else {
  console.log("Usage: hono-svelte <init|doctor> [--app=<dir>]");
  process.exitCode = 1;
}
