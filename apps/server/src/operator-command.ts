import { readFile } from "node:fs/promises";

import { cleanupPublishingCopies, PublishingRejected, runOperatorCommand, type PublishingDeps } from "@cart-campuss/api/publishing";
import { runScheduledRecheck, withdrawPublishedContent } from "@cart-campuss/api/recheck";

export { runOperatorCommand };

function runningAsOperatorCli(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.includes("operator-command.ts") || entry.includes("operator-command.js");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const file = process.argv[3];
  const recognized =
    (command === "apply" && file) ||
    (command === "cleanup" && !file) ||
    (command === "recheck" && !file) ||
    (command === "recheck" && Boolean(file)) ||
    (command === "withdraw" && file);
  if (!recognized) {
    process.stderr.write(
      "Usage: tsx src/operator-command.ts apply <import.json> | cleanup | recheck [report.json] | withdraw <withdrawal.json>\n",
    );
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
    if (command === "cleanup") {
      const result = await cleanupPublishingCopies(deps, deps.operatorToken ?? undefined);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "recheck") {
      const report = file ? await readFile(file, "utf8") : null;
      const result = await runScheduledRecheck(deps, deps.operatorToken ?? undefined, report);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (command === "withdraw" && file) {
      const result = await withdrawPublishedContent(deps, deps.operatorToken ?? undefined, await readFile(file, "utf8"));
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (file) {
      const result = await runOperatorCommand(deps, await readFile(file, "utf8"));
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (result.status === "held") process.exitCode = 2;
    }
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
