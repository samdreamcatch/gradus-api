## Replace bespoke audience toggle with `SegmentedToggle`

In `src/routes/_authenticated/coach.settings.tsx`, inside `ConnectionsDisclosure`:

1. Add import: `import { SegmentedToggle } from "@/components/plans/segmented-toggle";`
2. Remove the local `options` array with `{ value, label }` shape.
3. Replace the hand-rolled `<div role="tablist">…<button>…</button></div>` block (lines ~365–388) with:
   ```tsx
   <SegmentedToggle
     value={audience}
     onChange={setAudience}
     options={[
       { key: "parents", label: "Youth parents" },
       { key: "adult-athletes", label: "Adult (18+)" },
     ]}
   />
   ```
4. Leave `audience` state and the `<InviteCard compact audience={audience} />` below unchanged.

Result: this toggle now matches every other segmented toggle in the app (typography, radius, `press-soft` feedback, accent-fill active state) per the design system.