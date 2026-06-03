import { PageTitle } from "@/components/page-title";

/**
 * Plans-style header used by every Messages screen.
 * Same big display title + Logo-matching highlighter stripe as other top-level pages.
 */
export function MessagesHeader({ subtitle }: { subtitle?: string }) {
  return <PageTitle subtitle={subtitle}>Messages</PageTitle>;
}
