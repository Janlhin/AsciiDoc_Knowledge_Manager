/**
 * T-045 (slice 2): Antora component / version discovery and resource-id lookup.
 *
 * Pure functions, no I/O. `parseAntoraYml` turns a descriptor file's text into
 * a component/version record; `buildAntoraIndex` maps the vault's flat path
 * list onto Antora's `modules/<module>/<family>/...` layout. The caller (the
 * audit runner) owns every read, so this module stays unit-testable.
 *
 * Antora content roots are directories containing `antora.yml`:
 *
 *   docs/catalog/2.0/antora.yml          name: catalog   version: "2.0"
 *   docs/catalog/2.0/modules/ROOT/pages/index.adoc
 *   docs/catalog/2.0/modules/ROOT/partials/intro.adoc
 *
 * A resource id is `[version@]component[:module][:family$]path`. When several
 * versions of a component exist and the id omits the version, we only use the
 * version of the *current* file; otherwise the answer is honestly `unresolved`
 * instead of silently picking a version (see docs/docs-as-code-baseline.adoc).
 *
 * Slice-1 behaviour is preserved when no descriptor is present: with an empty
 * index `resolveAntoraResource` returns null and docsAsCode falls back to the
 * unique-basename heuristic.
 */
import { load } from "js-yaml";
import type { DocResolution } from "./docsAsCode";

/** Antora's standard content families → directory names under `modules/`. */
const FAMILY_DIRS: Readonly<Record<string, string>> = {
  pages: "page",
  partials: "partial",
  examples: "example",
  images: "image",
  attachments: "attachment",
};

const APPENDABLE = [".adoc", ".md"] as const;

export interface AntoraComponent {
  /** Vault-relative path of `antora.yml`. */
  readonly descriptorPath: string;
  /** Vault-relative directory that owns this component version ("" = root). */
  readonly root: string;
  readonly name: string;
  /** "" means an unversioned component (Antora allows omitting `version`). */
  readonly version: string;
}

export interface AntoraOwner {
  readonly component: AntoraComponent;
  readonly module: string;
  readonly family: string;
}

export interface AntoraIndex {
  readonly components: ReadonlyArray<AntoraComponent>;
  /** `name@version:module:family:resource` → vault path, all lower-cased. */
  readonly byKey: ReadonlyMap<string, string>;
  readonly byName: ReadonlyMap<string, ReadonlyArray<AntoraComponent>>;
  /** Which component/module/family a concrete file belongs to. */
  readonly owner: ReadonlyMap<string, AntoraOwner>;
  /** Lower-cased module names by `name@version` — O(1) module lookup. */
  readonly modulesByComponent: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The subset of a parsed xref needed for a resource-id lookup. */
export interface AntoraTarget {
  readonly version?: string;
  readonly component?: string;
  readonly module?: string;
  readonly family?: string;
  readonly path: string;
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * Parse one `antora.yml`. Returns null for absent/invalid descriptors — a
 * malformed file is never a reason to invent a component. `js-yaml@4` is an
 * existing runtime dependency (also used by the Obsidian compat layer).
 */
export function parseAntoraYml(source: string, descriptorPath: string): AntoraComponent | null {
  let data: unknown;
  try {
    data = load(source);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  const name = scalar(obj.name);
  if (name === "") return null;
  const version = scalar(obj.version);
  const slash = descriptorPath.lastIndexOf("/");
  return {
    descriptorPath,
    root: slash >= 0 ? descriptorPath.slice(0, slash) : "",
    name,
    version,
  };
}

function componentKey(component: AntoraComponent): string {
  return `${component.name}@${component.version}`.toLowerCase();
}

function resourceKey(
  component: AntoraComponent,
  module: string,
  family: string,
  resource: string,
): string {
  return `${componentKey(component)}:${module}:${family}:${resource}`.toLowerCase();
}

/**
 * Build the lookup tables. Descriptors with longer roots win, so a nested
 * component version never gets swallowed by an outer one.
 */
export function buildAntoraIndex(
  components: ReadonlyArray<AntoraComponent>,
  paths: ReadonlyArray<string>,
): AntoraIndex {
  const byKey = new Map<string, string>();
  const byName = new Map<string, AntoraComponent[]>();
  const owner = new Map<string, AntoraOwner>();
  const modulesByComponent = new Map<string, Set<string>>();

  for (const component of components) {
    const key = component.name.toLowerCase();
    const bucket = byName.get(key);
    if (bucket === undefined) byName.set(key, [component]);
    else bucket.push(component);
  }

  const ordered = [...components].sort((a, b) => b.root.length - a.root.length);
  for (const path of paths) {
    const component = ordered.find((c) =>
      c.root === "" ? true : path.startsWith(`${c.root}/`));
    if (component === undefined) continue;
    const rel = component.root === "" ? path : path.slice(component.root.length + 1);
    const match = /^modules\/([^/]+)\/([^/]+)\/(.+)$/.exec(rel);
    if (match === null) continue;
    const module = match[1];
    const family = FAMILY_DIRS[match[2].toLowerCase()] ?? match[2].toLowerCase();
    const resource = match[3];
    owner.set(path, { component, module, family });
    byKey.set(resourceKey(component, module, family, resource), path);
    const cKey = componentKey(component);
    const modules = modulesByComponent.get(cKey);
    if (modules === undefined) modulesByComponent.set(cKey, new Set([module.toLowerCase()]));
    else modules.add(module.toLowerCase());
  }

  return { components, byKey, byName, owner, modulesByComponent };
}

function lookupResource(
  component: AntoraComponent,
  module: string,
  family: string,
  targetPath: string,
  index: AntoraIndex,
): string | undefined {
  const candidates = /\.[A-Za-z0-9]+$/.test(targetPath)
    ? [targetPath]
    : [targetPath, `${targetPath}.adoc`, `${targetPath}.md`];
  for (const candidate of candidates) {
    const hit = index.byKey.get(resourceKey(component, module, family, candidate));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Whether `name` is a module of the current component (`ROOT:page.adoc` form). */
function isModuleOf(name: string, component: AntoraComponent, index: AntoraIndex): boolean {
  if (name.toUpperCase() === "ROOT") return true;
  return index.modulesByComponent.get(componentKey(component))?.has(name.toLowerCase()) ?? false;
}

/**
 * Resolve an explicit Antora resource id. Returns `null` when this is not an
 * Antora vault or the target carries no resource-id segment, so the caller can
 * keep the slice-1 (plain AsciiDoc) semantics untouched.
 */
export function resolveAntoraResource(
  target: AntoraTarget,
  fromPath: string,
  index: AntoraIndex,
): DocResolution | null {
  if (index.components.length === 0) return null;
  const explicit = target.version !== undefined ||
    target.component !== undefined ||
    target.module !== undefined ||
    target.family !== undefined;
  if (!explicit) return null;

  const from = index.owner.get(fromPath);
  let component: AntoraComponent | undefined;
  let module = target.module;

  if (target.component !== undefined) {
    const matches = index.byName.get(target.component.toLowerCase()) ?? [];
    if (matches.length === 0) {
      // Antora also accepts a bare `module:page.adoc`. Only reinterpret the
      // first segment as a module when the current component really has it;
      // a version-qualified id always names a component.
      if (target.version === undefined && from !== undefined &&
          isModuleOf(target.component, from.component, index)) {
        component = from.component;
        module = target.component;
      } else {
        return { status: "broken", failure: "missing" };
      }
    } else if (target.version !== undefined) {
      component = matches.find((c) => c.version.toLowerCase() === target.version!.toLowerCase());
      if (component === undefined) return { status: "broken", failure: "missing" };
    } else if (from !== undefined && matches.includes(from.component)) {
      component = from.component;
    } else if (matches.length === 1) {
      component = matches[0];
    } else {
      return { status: "unresolved", failure: "ambiguous", candidates: matches.length, reason: "versions" };
    }
  } else if (from !== undefined) {
    component = from.component;
  } else {
    const names = [...index.byName.keys()];
    if (names.length === 1 && index.byName.get(names[0])!.length === 1) {
      component = index.byName.get(names[0])![0];
    }
    if (component === undefined) {
      return { status: "unresolved", failure: "ambiguous", candidates: index.components.length, reason: "versions" };
    }
  }

  const effectiveModule = module ??
    (from !== undefined && from.component === component ? from.module : undefined) ?? "ROOT";
  const family = target.family ?? "page";
  const path = lookupResource(component, effectiveModule, family, target.path, index);
  if (path === undefined) return { status: "broken", failure: "missing" };
  return { status: "resolved", path, via: "antora" };
}
