/**
 * Vite `?raw` import typing, shared project-wide (the project tsconfig does
 * not include vite/client types). Moved from features/export in R20 — the
 * compat layer also imports `?raw` (theme-bridge.scss) and must not depend on
 * a declaration physically owned by a feature folder (layering).
 */
declare module "*.css?raw" {
  const content: string;
  export default content;
}

declare module "*.scss?raw" {
  const content: string;
  export default content;
}
