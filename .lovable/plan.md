## Why this happened

`src/components/coach/voice-fab.tsx` is rendered on `/coach/plans`. It imports `voiceBuildPlan` (a server fn) and the `VoiceSources` type from `src/lib/voice.functions.ts`. That file has a hard runtime guard at the top:

```ts
if (typeof window !== "undefined") {
  throw new Error("voice.functions.ts is server-only and must not be imported in the browser");
}
```

The TanStack server-fn splitter only stubs out `createServerFn().handler()` bodies. It does NOT strip arbitrary module-level statements, plain helper functions, or non-server-fn imports. `voice.functions.ts` has all of those — including the throw guard and a top-level `import { createLovableAiGatewayProvider } from "./ai-gateway.server"` — so the client bundle still evaluates the file's top scope at import time and the guard fires.

The previous `messages.functions.ts` SSR crash was the same bug. We fixed it for messages by splitting the file (server logic → `messages.server.ts`, types → `messages-types.ts`, server-fn declarations only → `messages.functions.ts`). The new messaging code shipped in this thread shifted Vite's chunk graph, which now pulls `voice.functions.ts` into the coach plans client chunk earlier — exposing the same latent bug.

## Plan

Apply the same split to the voice module. No behavior changes.

1. **Create `src/lib/voice-types.ts`** — extract the four exported types (`FieldSource`, `VoiceSources`, `VoicePlanDraft`, `VoiceTouched`). Client-safe.

2. **Create `src/lib/voice.server.ts`** — move all server-only helpers and imports out of `voice.functions.ts`: `getCoachId`, the AI gateway provider, ElevenLabs/transcription helpers, plan-building logic, `MAX_AUDIO_BYTES`, and the `ai-gateway.server` import. The `*.server.ts` extension is hard-blocked from client bundles by the import-protection plugin, so this seals the boundary at the bundler level.

3. **Slim `src/lib/voice.functions.ts`** to just:
   - `createServerFn` import + middleware import
   - `createServerFn` declarations (currently just `voiceBuildPlan`; verify no other server fns exist in the file's 898 lines and move any I find)
   - re-export the types from `voice-types.ts` so existing call sites don't need to change
   - **remove the `if (typeof window !== "undefined") throw` guard** — the `*.server.ts` extension on the moved file enforces the boundary correctly; the guard was a defensive workaround that itself broke the client.

4. **Update two client importers** to pull types from the new module (keeps the dependency graph from reaching back into `voice.functions.ts` for type-only imports):
   - `src/components/coach/voice-fab.tsx` — `import type { VoiceSources } from "@/lib/voice-types"`
   - `src/lib/voice-touched-store.ts` — `import type { VoiceSources } from "./voice-types"`
   - `voice-fab.tsx` still imports the runtime `voiceBuildPlan` from `voice.functions.ts`, which is correct (server-fn calls become RPC stubs on the client).

5. **Verify the build** loads `/coach/plans` without the "server-only" error.

## Out of scope

- No changes to `voiceBuildPlan`'s signature, behavior, or AI prompt.
- No changes to `/coach/messages` work from earlier this thread.
- No changes to other `.functions.ts` files (we'd address them only if a similar symptom appears).
