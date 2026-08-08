import { toast } from "sonner";

/** Native share sheet, with a clipboard fallback for desktop browsers. */
export async function shareInvoiceText(text: string) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      // User dismissed the sheet, or share isn't allowed — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invoice copied to clipboard");
  } catch {
    toast.error("Couldn't share the invoice");
  }
}
