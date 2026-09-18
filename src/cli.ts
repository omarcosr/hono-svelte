#!/usr/bin/env node
// Thin CLI wrapper: `hono-svelte init` / `hono-svelte doctor`.
// Compiled to `dist/cli.js` and invoked via the `hono-svelte` bin.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  doctorChecks,
  checkAppLink,
  initFiles,
  isSafeAppPath,
  type InitFlavor,
} from "./scaffold.js";

const args = process.argv.slice(2);
const command = args[0];

function flagValue(name: string): string | undefined {
  const pref = `--${name}=`;
  const hit = args.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const appRoot = flagValue("app") ?? process.cwd();
const flavor: InitFlavor = hasFlag("full") ? "full" : "minimal";

function init(): void {
  const files = initFiles(flavor);
  for (const file of files) {
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
  console.log(`[hono-svelte] done (${flavor}). Next:`);
  if (flavor === "minimal") {
    console.log(`  1. bun install`);
    console.log(`  2. bun run dev   (or: bun --bun run dev)`);
    console.log(`  Tip: --full scaffolds auth + dashboard + layout + typed RPC.`);
  } else {
    console.log(`  1. bun install`);
    console.log(`  2. bun run dev   (or: bun --bun run dev)   →  /auth → /dashboard`);
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
  console.log("Usage: hono-svelte <init|doctor> [--app=<dir>] [--full]");
  console.log("  init [--full]   scaffold a runnable app (minimal by default)");
  process.exitCode = 1;
}
