import { readFile } from "node:fs/promises";

import { PublishingRejected, runOperatorCommand, type PublishingDeps } from "@cart-campuss/api/publishing";

export { runOperatorCommand };

function runningAsOperatorCli(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.includes("operator-command.ts") || entry.includes("operator-command.js");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const file = process.argv[3];
  if (command !== "apply" || !file) {
    process.stderr.write("Usage: tsx src/operator-command.ts apply <import.json>\n");
    process.exitCode = 1;
    return;
  }

  const { ENV } = await import("./env.server");
  const { createDb } = await import("@cart-campuss/db");
  const deps: PublishingDeps = {
    db: createDb({ DATABASE_URL: ENV.DATABASE_URL }),
    operatorToken: ENV.OPERATOR_TOKEN ?? null,
  };
  try {
    const result = await runOperatorCommand(deps, await readFile(file, "utf8"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === "held") process.exitCode = 2;
  } catch (error) {
    const message =
      error instanceof PublishingRejected ? `${error.code}: ${error.message}` : "The operator command failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (runningAsOperatorCli()) {
  await main();
}
