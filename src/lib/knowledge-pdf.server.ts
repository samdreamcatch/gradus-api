/**
 * PDF text extraction for the knowledge corpus, page range at a time.
 *
 * `unpdf` ships a serverless build of pdf.js that runs in the Cloudflare
 * Worker. Opening the document parses only the cross-reference table, so
 * a 300-page rulebook is opened cheaply on every ingest tick and only the
 * pages in `[from, to)` are read; the ingest loop checkpoints each window
 * into `knowledge_pages`. Kept in its own module so the ingest state
 * machine can be unit-tested with an injected extractor and never loads
 * pdf.js in tests.
 */
import { getDocumentProxy } from "unpdf";

export type PdfPageExtractor = (
  bytes: Uint8Array,
  from: number,
  to: number,
) => Promise<{ pageCount: number; pages: Array<{ page: number; text: string }> }>;

type TextItem = { str?: string; hasEOL?: boolean };

export const extractPdfPages: PdfPageExtractor = async (bytes, from, to) => {
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages;
  const pages: Array<{ page: number; text: string }> = [];
  const last = Math.min(to, pageCount + 1);
  for (let n = Math.max(1, from); n < last; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items as TextItem[]) {
      if (typeof item.str === "string") text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    pages.push({ page: n, text });
    page.cleanup();
  }
  return { pageCount, pages };
};
