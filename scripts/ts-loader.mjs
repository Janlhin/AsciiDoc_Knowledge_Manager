/**
 * T-063 — minimal ESM resolve hook for running TS bench cores under plain Node.
 *
 * The frozen `src/` layout kernel uses extensionless relative imports
 * (`from "./types"`), which plain Node ESM cannot resolve on its own. This
 * hook only appends `.ts` to an extensionless relative specifier when that
 * file exists; everything else falls through to the default resolver.
 * No source files are modified for this.
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const url = new URL(specifier, context.parentURL);
    const pathname = fileURLToPath(url);
    if (!/\.[a-zA-Z]+$/.test(pathname) && existsSync(`${pathname}.ts`)) {
      return { url: pathToFileURL(`${pathname}.ts`).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
