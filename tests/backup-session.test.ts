// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { tauriBackupIO } from "@core/backup";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

it("routes chunks and finish by session, with an exact declared size", async () => {
  invoke.mockImplementation(async (cmd: string) => cmd === "export_begin_binary" ? "owned-session" : undefined);
  const data = new Uint8Array(4 * 1024 * 1024 + 3).fill(71);
  await tauriBackupIO().writeBinary("D:/bk/a.zip", data);
  expect(invoke.mock.calls.map(x => x[0])).toEqual([
    "export_begin_binary", "export_append_binary", "export_append_binary", "export_finish_binary",
  ]);
  expect(invoke.mock.calls[0][1]).toEqual({ path: "D:/bk/a.zip", expectedBytes: data.length });
  const chunks = invoke.mock.calls.filter(x => x[0] === "export_append_binary").map(x => x[1]);
  expect(chunks.map(x => atob(x.data).length)).toEqual([4 * 1024 * 1024, 3]);
  expect(chunks.every(x => x.session === "owned-session" && !("path" in x))).toBe(true);
  expect(invoke.mock.calls[3][1]).toEqual({ session: "owned-session" });
});

it.each(["export_append_binary", "export_finish_binary"])("aborts its own session when %s fails", async (failed) => {
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "export_begin_binary") return "mine";
    if (cmd === failed) throw new Error("original failure");
    if (cmd === "export_abort_binary") throw new Error("cleanup failed");
  });
  await expect(tauriBackupIO().writeBinary("D:/bk/a.zip", new Uint8Array([1]))).rejects.toThrow("original failure");
  expect(invoke).toHaveBeenLastCalledWith("export_abort_binary", { session: "mine" });
  if (failed === "export_append_binary") expect(invoke.mock.calls.some(x => x[0] === "export_finish_binary")).toBe(false);
});

it("does not abort an unknown session when begin fails", async () => {
  invoke.mockRejectedValue(new Error("begin failed"));
  await expect(tauriBackupIO().writeBinary("D:/bk/a.zip", new Uint8Array([1]))).rejects.toThrow("begin failed");
  expect(invoke).toHaveBeenCalledTimes(1);
});
