/**
 * Ambient module declarations for the node-side scripts.
 *
 * These scripts are type-checked by their own tsconfig (scripts/tsconfig.json)
 * so that Node globals are available without polluting the app's DOM-based
 * type environment. Only `mammoth` lacks a bundled .d.ts (the app declares it
 * in src/format-shims.d.ts; the scripts cannot reach that file because it
 * lives outside this tsconfig's include set).
 */
declare module "mammoth";
