import { toast } from "sonner";
import { canShareNatively, shareNatively } from "@/lib/native";

/**
 * Open the OS-native share sheet with the invoice text.
 *
 * MUST be called synchronously inside the click handler — awaiting anything
 * first consumes user activation and iOS Safari refuses to open the sheet.
 * Falls back to the clipboard when the browser has no share support, or when
 * the share fails for a reason other than the user cancelling.
 */
export function shareInvoiceNow(text: string) {
  if (canShareNatively()) {
    shareNatively({
      title: "Invoice from Gradus",
      text,
    }).catch((err: unknown) => {
      if ((err as DOMException)?.name === "AbortError") return;
      void copyFallback(text);
    });
    return;
  }
  void copyFallback(text);
}

async function copyFallback(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invoice copied to clipboard");
  } catch {
    toast.error("Couldn't share the invoice");
  }
}
