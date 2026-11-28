/**
 * Bootstrap for the kernel microbenchmark.
 *
 * Plain Node cannot resolve the frozen `src/` kernel's extensionless relative
 * imports on its own; this registers the shared `ts-loader.mjs` resolve hook,
 * then loads `kernel-bench-core.ts`, which does the actual measurement.
 * Usage and gate posture live in `kernel-bench-core.ts` and
 * `docs/t063-bench.adoc` §CI 门禁.
 */
import { register } from "node:module";

register(new URL("./ts-loader.mjs", import.meta.url));
await import("./kernel-bench-core.ts");
