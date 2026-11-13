/**
 * Side-effect style imports.
 *
 * TS 7 resolves side-effect imports, so every Vite-handled stylesheet needs an
 * ambient declaration. `*.css?raw` is declared separately in raw-import.d.ts.
 */
declare module "*.scss";
declare module "*.css";
declare module "*.sass";
