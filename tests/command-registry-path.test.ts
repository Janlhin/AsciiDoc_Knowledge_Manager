import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("command registry verification", () => {
  it("can resolve its real checkout path, including URL-escaped characters", () => {
    const script = fileURLToPath(new URL("../scripts/verify-command-registry.ts", import.meta.url));
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr + result.stdout).toBe(0);
  });
});
