import { DevTools } from "./dev-tools";

// `import.meta.env.DEV` is statically replaced by Vite at build time.
// In prod this becomes `false ? DevTools : () => null`, which Rollup
// constant-folds to `() => null` and drops the DevTools import entirely
// — so the whole src/components/dev tree tree-shakes out of production.
export const DevToolsMount = import.meta.env.DEV ? DevTools : () => null;
