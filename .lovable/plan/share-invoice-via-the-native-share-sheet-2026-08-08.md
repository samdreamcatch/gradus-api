# Share invoice via the native share sheet

Today "Share invoice" often just copies to the clipboard. The reason is timing, not a missing feature: the code already tries the native share sheet, but on two of the three paths it first waits on a server call (creating the invoice, or loading invoice details). Browsers — especially iOS Safari — only allow the native share sheet to open as a direct result of a tap, so once we wait, the tap "expires" and the code falls back to copying.

Fix: have the invoice text ready before the tap, then open the share sheet immediately on tap, exactly like the plan/invite share buttons already do.

## What changes

1. **Shared helper (`src/lib/share-invoice.ts`)**
   - Split into a synchronous `shareInvoiceNow(text)` that calls the native share sheet immediately and only falls back to clipboard when the browser has no share support or the share fails for a non-cancel reason.
   - Dismissing the share sheet stays silent (no "copied" toast).

2. **Create & share (`invoice-generate-sheet.tsx`)**
   - The invoice must be created on the server before it can be shared, so the tap is consumed. After a successful create, show a short confirmation state in the sheet with a **Share invoice** button; tapping that opens the native share sheet directly.

3. **Re-share from the athlete billing list (`athlete-billing-section.tsx`)**
   - Prefetch invoice details when the list renders, so tapping share can open the sheet right away. If details aren't loaded yet, fall back to the current behavior.

4. **Invoice detail sheet (`invoice-detail-sheet.tsx`)**
   - Already has all data on screen; just point it at the new synchronous helper.

## Technical notes

- `navigator.share()` must be invoked synchronously in the click handler (no `await` before it) to preserve user activation; `AbortError` means the user cancelled and should be ignored.
- Prefetching uses the existing `getInvoiceDetail` server function through React Query with a short `staleTime`.
- Desktop browsers without `navigator.share` keep the clipboard fallback and its toast.
