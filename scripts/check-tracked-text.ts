/**
 * Tracked-text baseline. This is not a code formatter and it does not check types.
 *
 * Fails when a tracked text file has a CR byte, no final newline, or trailing
 * whitespace. Skips symlinks, empty files, and files that contain a NUL byte.
 * Does not rewrite files or wrap lines.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const listed = execFileSync("git", ["ls-files", "-z"], { cwd: root });
const files = listed.toString("utf8").split("\0").filter((file) => file.length > 0);
const failures: string[] = [];
let checked = 0;

for (const file of files) {
  const path = join(root, file);
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) continue;
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes.includes(0)) continue;
  checked += 1;
  const text = bytes.toString("utf8");
  if (text.includes("\r")) failures.push(`${file}: CR byte; use LF line endings`);
  if (!text.endsWith("\n")) failures.push(`${file}: missing final newline`);
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (index === lines.length - 1 && line === "") continue;
    if (/[ \t]+$/.test(line)) {
      failures.push(`${file}:${index + 1}: trailing whitespace`);
      break;
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`Tracked text check failed (${failures.length}).`);
  process.exit(1);
}

console.log(
  `Checked ${checked} tracked text files for LF, a final newline, and no trailing whitespace.`,
);
