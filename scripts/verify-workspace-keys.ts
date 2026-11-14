#!/usr/bin/env node
/**
 * Behaviour check for the per-vault workspace storage keys
 * (src/core/workspaceKeys.ts).
 *
 * The interesting failure is silent: two vaults that look different to a user
 * ("C:\Vault" and "c:/vault/") must resolve to ONE key, and two different vaults
 * must never share one — otherwise reopening a vault restores another vault's
 * tabs. These are pure functions, so they can be exercised without a browser.
 *
 * Usage: node scripts/verify-workspace-keys.ts
 * Exit code: 0 = all cases pass, 1 = at least one mismatch.
 */
import {
  LEGACY_WORKSPACE_KEY,
  WORKSPACE_KEY_PREFIX,
  normalizeVaultPath,
  workspaceStateKey,
} from "../src/core/workspaceKeys.ts";

let failures = 0;
let cases = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  cases += 1;
  if (actual === expected) return;
  failures += 1;
  console.error(`FAIL ${name}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

/* ---- no vault: the legacy/global key, which is also the migration source ---- */
check("null → legacy", workspaceStateKey(null), LEGACY_WORKSPACE_KEY);
check("undefined → legacy", workspaceStateKey(undefined), LEGACY_WORKSPACE_KEY);
check("empty string → legacy", workspaceStateKey(""), LEGACY_WORKSPACE_KEY);
check("separator only → legacy", workspaceStateKey("\\\\"), LEGACY_WORKSPACE_KEY);

/* ---- normalisation: one vault must not fan out into several keys ---- */
check("backslashes", normalizeVaultPath("C:\\Vault"), "c:/vault");
check("trailing separator", normalizeVaultPath("C:\\Vault\\"), "c:/vault");
check("forward slashes", normalizeVaultPath("c:/vault/"), "c:/vault");
check("repeated separators", normalizeVaultPath("C://Vault//"), "c:/vault");
check("unicode + spaces", normalizeVaultPath("D:\\我的 笔记\\"), "d:/我的 笔记");

check(
  "win and posix forms collapse",
  workspaceStateKey("C:\\Vault\\"),
  workspaceStateKey("c:/vault"),
);
check(
  "nested path collapse",
  workspaceStateKey("C:\\Work\\Vault\\Sub\\"),
  workspaceStateKey("c:/work/vault/sub"),
);

/* ---- isolation: different vaults must not collide ---- */
check(
  "sibling vaults differ",
  workspaceStateKey("C:/Work/A") === workspaceStateKey("C:/Work/B"),
  false,
);
check(
  "prefix collision differs",
  workspaceStateKey("C:/Work/Vault") === workspaceStateKey("C:/Work/Vault2"),
  false,
);

/* ---- shape: a real vault never lands on the legacy key ---- */
check(
  "vault key is prefixed",
  workspaceStateKey("C:/Work/Vault").startsWith(WORKSPACE_KEY_PREFIX),
  true,
);
check(
  "vault key is not legacy",
  workspaceStateKey("C:/Work/Vault") === LEGACY_WORKSPACE_KEY,
  false,
);

/* ---- stability: same input, same key (persist/restore must agree) ---- */
check(
  "stable across calls",
  workspaceStateKey("C:\\Users\\me\\Vault"),
  workspaceStateKey("C:\\Users\\me\\Vault"),
);

console.log(
  failures === 0
    ? `workspace-keys: ${cases}/${cases} cases pass`
    : `workspace-keys: ${failures} of ${cases} cases FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
