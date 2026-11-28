/**
 * T-063 (C): entry-point constants + helpers for the standalone GPU graph view.
 * Kept side-effect free so tests can register the view type without booting the app.
 */
import type { GeodeApp } from "@app/AppContext";

/** `viewType` string for the GPU graph singleton tab. */
export const GPU_GRAPH_VIEW_TYPE = "graphgpu" as const;

/** Command registry id for the command-palette entry. */
export const OPEN_GPU_GRAPH_COMMAND_ID = "app:open-gpu-graph";

/** i18n dict key for the command name. */
export const OPEN_GPU_GRAPH_NAME_KEY = "cmd.openGpuGraph";

/** Open (or focus) the GPU graph singleton view. Mirrors `workspace.openGraph()`. */
export function openGpuGraphView(app: GeodeApp): void {
  app.workspace.openGpuGraph();
}
