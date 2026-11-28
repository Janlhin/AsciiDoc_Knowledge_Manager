/**
 * T-063 (C): entry-point registration tests — view type, singleton guard,
 * command id scheme and i18n keys present in both en and zh.
 */
import { describe, expect, it } from "vitest";
import { isFilelessSingletonView } from "@core/workspace";
import { en, zh } from "@core/i18n/dict.app";
import {
  GPU_GRAPH_VIEW_TYPE,
  OPEN_GPU_GRAPH_COMMAND_ID,
  OPEN_GPU_GRAPH_NAME_KEY,
  openGpuGraphView,
} from "@features/graph/gpu/entry";

const enDict = en as Record<string, string>;
const zhDict = zh as Record<string, string>;

describe("gpu-graph entry wiring", () => {
  it("registers the singleton view type", () => {
    expect(GPU_GRAPH_VIEW_TYPE).toBe("graphgpu");
    expect(isFilelessSingletonView("graphgpu")).toBe(true);
    expect(isFilelessSingletonView("markdown")).toBe(false);
  });

  it("command id follows the registry scheme and its name exists in en/zh", () => {
    expect(/^[a-z][a-z0-9-]*:[a-zA-Z0-9:_-]+$/.test(OPEN_GPU_GRAPH_COMMAND_ID)).toBe(true);
    expect(OPEN_GPU_GRAPH_NAME_KEY).toBe("cmd.openGpuGraph");
    expect(enDict[OPEN_GPU_GRAPH_NAME_KEY]).toBeTruthy();
    expect(zhDict[OPEN_GPU_GRAPH_NAME_KEY]).toBeTruthy();
  });

  it("openGpuGraphView delegates to workspace.openGpuGraph", () => {
    const calls: string[] = [];
    const app = { workspace: { openGpuGraph: () => calls.push("open") } };
    openGpuGraphView(app as Parameters<typeof openGpuGraphView>[0]);
    expect(calls).toEqual(["open"]);
  });
});
