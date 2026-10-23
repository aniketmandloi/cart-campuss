import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lockDirectory = join(tmpdir(), "cart-campuss-catalogue-public-lock");

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function ownerPid(): number | undefined {
  try {
    const pid = Number(readFileSync(join(lockDirectory, "pid"), "utf8"));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function abandoned(): boolean {
  const pid = ownerPid();
  if (pid !== undefined) return !processAlive(pid);
  try {
    return Date.now() - statSync(lockDirectory).mtimeMs > 1_000;
  } catch {
    return false;
  }
}

/**
 * The isolated catalogue runner rejects any public-relation change between open
 * and close. A public sentinel and the journey therefore take turns.
 */
export function acquireCataloguePublicLock(): () => void {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDirectory);
      try {
        writeFileSync(join(lockDirectory, "pid"), String(process.pid));
      } catch (error) {
        rmSync(lockDirectory, { recursive: true, force: true });
        throw error;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (ownerPid() === process.pid) rmSync(lockDirectory, { recursive: true, force: true });
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (abandoned()) {
        rmSync(lockDirectory, { recursive: true, force: true });
        continue;
      }
      pause(50);
    }
  }
  throw new Error("Timed out waiting to use the public schema in the catalogue test database.");
}
