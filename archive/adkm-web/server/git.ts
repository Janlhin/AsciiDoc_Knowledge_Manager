/** Git 状态查询（只读，不执行任何写操作） */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatus } from "../shared/types.ts";

const run = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: root,
    timeout: 8000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.toString();
}

function parsePorcelain(out: string): { branch?: string; ahead?: number; behind?: number; files: { path: string; status: string }[] } {
  const lines = out.split(/\r?\n/).filter(Boolean);
  let branch: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;
  const files: { path: string; status: string }[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      // 形如 main...origin/main [ahead 2, behind 1]
      const m = /^([^.\s]+)/.exec(head);
      branch = m?.[1];
      const a = /ahead (\d+)/.exec(head);
      const b = /behind (\d+)/.exec(head);
      if (a) ahead = Number(a[1]);
      if (b) behind = Number(b[1]);
      continue;
    }
    const status = line.slice(0, 2).trim() || "?";
    const p = line.slice(3).trim();
    if (p) files.push({ path: p, status });
  }
  return { branch, ahead, behind, files };
}

export async function readGitStatus(root: string): Promise<GitStatus> {
  try {
    const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.trim() !== "true") return { available: false };
  } catch {
    return { available: false, error: "不是 Git 仓库" };
  }

  try {
    const [porcelain, log] = await Promise.all([
      git(root, ["status", "--porcelain=v1", "-b"]),
      git(root, ["log", "-1", "--format=%h%x00%s%x00%cI"]).catch(() => ""),
    ]);

    const parsed = parsePorcelain(porcelain);
    let lastCommit: GitStatus["lastCommit"];
    const parts = log.split("\u0000").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      lastCommit = { hash: parts[0], message: parts[1], date: parts[2] };
    }

    return {
      available: true,
      branch: parsed.branch,
      ahead: parsed.ahead,
      behind: parsed.behind,
      changed: parsed.files.length,
      files: parsed.files.slice(0, 200),
      lastCommit,
    };
  } catch (e) {
    return { available: true, error: e instanceof Error ? e.message : "git 查询失败" };
  }
}
