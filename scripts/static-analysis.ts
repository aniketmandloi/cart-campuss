/**
 * Static analysis for this repository is the existing TypeScript check.
 *
 * Scope: `pnpm check-types`, which runs `tsc --noEmit` in every workspace
 * package that defines that script, including the native workspace as types only.
 * Limits: no ESLint or other linter, no formatter, no runtime test, no browser,
 * and no simulator or device build.
 */
import { execFileSync } from "node:child_process";

console.log(
  [
    "Static analysis runs the existing workspace TypeScript checks (tsc --noEmit).",
    "Scope: every package script named check-types, including the native workspace as types only.",
    "Limits: no ESLint or other linter, no formatter, no runtime test, no browser, and no simulator.",
  ].join("\n"),
);

execFileSync("pnpm", ["check-types"], { stdio: "inherit" });
