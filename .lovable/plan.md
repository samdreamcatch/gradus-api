# Sample invoice for Sample Athlete

Let a coach generate an invoice for Sample Athlete so the invoicing value prop is visible before any real athlete exists — fully synthetic, nothing written to the database.

## What the coach sees

- Sample Athlete appears in Roster → Billing with the same "Invoice" button as a real athlete, and her detail sheet shows the same Billing section (rate + Generate invoice) instead of hiding it.
- Her rate is pre-set at $70 per session, so there's no "set a rate first" blocker.
- Opening the invoice sheet shows 4 recent lessons from her sample schedule, dated over the last two weeks, all pre-checked at $70, totaling $280. The coach can uncheck lines and edit amounts exactly as normal; the total updates live.
- "Create & share" produces the same plain-text invoice and opens the native share sheet.
- After creating, the invoice appears in her billing history as unpaid, marked with a "Sample" chip, and can be reopened and shared. It lives only for the current session — nothing persists, nothing is billed, and no server function is called.
- Dismissing the sample athlete removes it all, as today.

## Guardrails

- No server calls with the sample ID: preview, create, rate save, status change and delete are all short-circuited.
- Delete/mark-paid on the sample invoice act locally so the flow feels real without touching backend data.

## Technical notes

- Extend `src/data/sample-athlete.ts`: export a sample rate (`per_session`, 7000), a `buildSampleInvoiceDraft()` returning the `InvoicePreviewDTO` shape from `invoicing.functions.ts` (4 lines derived from `new Date()` offsets, state `confirmed`, `defaultIncluded: true`), and a sample billing payload matching `getAthleteBilling`'s return type.
- `invoice-generate-sheet.tsx`: when `isSampleAthlete(athleteId)`, feed the fixture draft (query `enabled: false`) and, on create, build the text with the existing `buildInvoiceText` + `shareInvoiceNow` instead of calling `createInvoice`; record the created invoice in a small in-memory store.
- `athlete-billing-section.tsx`: same short-circuit for `getAthleteBilling`, mutations become local no-ops, and the section renders for the sample instead of being skipped.
- New module `src/data/sample-invoices.ts` (module-level array + `useSyncExternalStore` subscription) holds created sample invoices for the session; `invoice-detail-sheet.tsx` reads from it when the id is a sample id.
- `billing-tab.tsx` needs no change beyond passing the sample athlete through, which the roster route already does.
- Reuses existing Sheet, Button, Tag, Checkbox, Input and invoice-format helpers — no new design-system pieces.
