/**
 * Bootstrap for the layout quality comparison tool.
 *
 * Registers the shared `ts-loader.mjs` resolve hook, then loads
 * `layout-quality-core.ts`, which computes edge-length statistics and the
 * approximate crossing count on the deterministic Node kernel.
 * Metrics and algorithm notes live in `layout-quality-core.ts` and
 * `docs/t063-bench.adoc` §布局质量对比.
 */
import { register } from "node:module";

register(new URL("./ts-loader.mjs", import.meta.url));
await import("./layout-quality-core.ts");
