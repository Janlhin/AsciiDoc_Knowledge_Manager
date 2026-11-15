import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("command registry verification", () => {
  it("resolves a path containing spaces regardless of checkout location", () => {
    const fixture = mkdtempSync(join(tmpdir(), "adkm command path "));
    try {
      mkdirSync(join(fixture, "scripts"));
      mkdirSync(join(fixture, "src", "core", "i18n"), { recursive: true });
      writeFileSync(join(fixture, "package.json"), '{"type":"module"}\n');
      writeFileSync(join(fixture, "src", "command.ts"), [
        'commands.register({',
        '  id: "fixture:open",',
        '  name: () => t("cmd.open"),',
        '  callback: () => {},',
        '});',
      ].join("\n"));
      writeFileSync(join(fixture, "src", "core", "i18n", "en.ts"),
        'export const en = { "cmd.open": "Open" };\n');
      const script = join(fixture, "scripts", "verify-command-registry.ts");
      copyFileSync(fileURLToPath(new URL("../scripts/verify-command-registry.ts", import.meta.url)), script);
      const result = spawnSync(process.execPath, [script], {
        cwd: fixture,
        encoding: "utf8",
        timeout: 10000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toContain("command ids: 1 unique / 1 literals | i18n keys used: 1");
    } finally {
      if (dirname(resolve(fixture)) !== resolve(tmpdir())) throw new Error("Unexpected fixture cleanup path");
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
