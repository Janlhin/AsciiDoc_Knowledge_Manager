/**
 * T-063 / Issue #20 — OS-side process probe for the benchmark reports.
 *
 * The CDP page can only see the V8 heap of its own renderer; RSS and thread
 * count live in the OS process table. On Windows PowerShell exports every
 * msedge.exe PID + command line + WorkingSet64 + thread count as JSON; this
 * module matches the run's unique profile directory in Node (string matching
 * there avoids nested shell quoting) and sums RSS / threads.
 *
 * Anything the probe cannot read is returned as `null` with a reason — the JSON
 * must record "unknown", never an estimated RSS or thread count.
 *
 * Non-Windows: the probe reports unavailable; the layout bench still records
 * the in-page V8 heap and the CDP metrics.
 */
import { spawnSync } from "node:child_process";

/**
 * @param {string} profileDir unique Edge user-data-dir for this bench run
 * @returns {{ available: boolean, reason?: string, processes: Array<object>,
 *   rssBytes: number|null, threads: number|null }}
 */
export function osEdgeTree(profileDir) {
  if (process.platform !== "win32") {
    return {
      available: false,
      reason: `os ${process.platform}: WMI/WorkingSet probe only implemented for Windows`,
      processes: [],
      rssBytes: null,
      threads: null,
    };
  }

  // One CIM pass; WorkingSet64 + thread count per PID via Get-Process.
  // Emit JSON and match the run's profile directory in Node below.
  const script = [
    "$rows = Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | ForEach-Object {",
    "  $pr = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue",
    "  [pscustomobject]@{",
    "    pid = $_.ProcessId",
    "    cmd = $_.CommandLine",
    "    rss = if ($pr) { [int64]$pr.WorkingSet64 } else { $null }",
    "    threads = if ($pr) { $pr.Threads.Count } else { $null }",
    "  }",
    "}",
    "$rows | ConvertTo-Json -Compress",
  ].join("\n");

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let r;
    try {
      r = spawnSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 20000 },
      );
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (r.error) {
      lastError = r.error.message;
      continue;
    }
    const out = (r.stdout || "").trim();
    if (!out) {
      lastError = `empty PowerShell output${(r.stderr || "").trim().slice(0, 200)}`;
      continue;
    }
    try {
      const parsed = JSON.parse(out);
      const all = Array.isArray(parsed) ? parsed : [parsed];
      const list = all
        .filter((p) => typeof p.cmd === "string" && p.cmd.includes(profileDir))
        .map((p) => {
          const typeMatch = /--type=([A-Za-z]+)/.exec(p.cmd);
          return {
            pid: p.pid,
            type: typeMatch ? typeMatch[1] : "browser",
            rssBytes: p.rss ?? null,
            threads: p.threads ?? null,
          };
        });
      return {
        available: true,
        processes: list,
        rssBytes: list.reduce((sum, p) => sum + (p.rssBytes ?? 0), 0) || null,
        threads: list.reduce((sum, p) => sum + (p.threads ?? 0), 0) || null,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    available: false,
    reason: lastError || "probe failed",
    processes: [],
    rssBytes: null,
    threads: null,
  };
}
