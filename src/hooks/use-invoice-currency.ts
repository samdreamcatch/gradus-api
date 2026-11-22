import { queryOptions, useQuery } from "@tanstack/react-query";
import { getMyInvoiceCurrency } from "@/lib/invoice-currency.functions";

/**
 * One read of the coach's invoice currency (decision #69), shared by every
 * invoicing screen through the query cache: never one request per row.
 */
export const invoiceCurrencyQueryOptions = queryOptions({
  queryKey: ["coach", "invoice-currency"],
  queryFn: () => getMyInvoiceCurrency(),
  // It changes only from the app's Settings, so it is not re-read on every mount.
  // A copy up to this old is fine for a rate or a draft; an invoice that exists
  // is always shown and shared in its own currency (`invoiceShareText`).
  staleTime: 5 * 60 * 1000,
  // A read that fails throws on the server, so it is tried once more and is
  // never kept as an answer: only "none to show" is cached as null.
  retry: 1,
});

/**
 * The coach's current invoice currency for rates, drafts and totals, and for
 * an invoice that carries none of its own (`displayCurrency`).
 *
 * `currency` is undefined while it is loading, when there is none to show and
 * when the read failed; the formatters read that as US dollars. `isLoading` lets a screen whose amounts
 * have no other currency wait, so it never shows a dollar sign first and then
 * changes it.
 *
 * `isLoading` is true only until the first answer, a failure included. A read
 * that failed is started again whenever another screen mounts or the window
 * regains focus, and React Query reports that as loading too; a screen that
 * went back to its spinner for it would close the sheet it had just opened,
 * whose body starts the read again, for as long as the read keeps failing.
 */
export function useCoachInvoiceCurrency(): { currency: string | undefined; isLoading: boolean } {
  const query = useQuery(invoiceCurrencyQueryOptions);
  return {
    currency: query.data?.invoiceCurrency ?? undefined,
    isLoading: query.isLoading && query.errorUpdateCount === 0,
  };
}
