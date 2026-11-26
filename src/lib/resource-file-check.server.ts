/**
 * The check every coach PDF passes before athletes or parents can see it
 * (Mariah, 2026-10-11): Gradus never keeps photos or video of athletes, so a
 * PDF with any embedded picture is held until a person at Gradus reviews it.
 * No AI and no outside service looks at the file; this runs in the Worker.
 *
 * Four independent detectors; any one of them holds the file:
 *  1. Image objects. An image XObject is a stream object, and a stream object
 *     can never sit inside a compressed object stream, so its dictionary
 *     (`/Subtype /Image`) is always readable in the raw bytes. Names are
 *     decoded first (`/Im#61ge` is `/Image`).
 *  2. Every stream, decoded here. A picture codec (JPEG, JPEG 2000, JBIG2,
 *     CCITT) means a picture; a stream that won't decode, or uses a filter
 *     this doesn't decode, can't be vouched for; a decoded stream with an
 *     inline image (`BI … ID`) is a picture.
 *  3. pdf.js. Every page's operator list is read for a picture-painting
 *     operator.
 *  4. Files carried inside the PDF (attachments, portfolios, rich media, XFA
 *     forms). Viewers show them, but no page draws them, so detectors 2 and
 *     3 would never see a photo inside one. Read from the object
 *     dictionaries and decoded object streams, names decoded; never from
 *     stream data, where the bytes could spell a name by chance.
 * Anything this can't read with confidence (including a secured PDF, whose
 * streams are encrypted) comes back "unreadable", which the
 * caller also holds: a false hold costs a review, a missed photo breaks the
 * promise.
 */
// `unpdf` (2.2 MB of pdf.js) is imported inside `checkPdfForPictures`, not
// here: every route shares one module graph, and a new Worker instance should
// not load pdf.js before answering requests that never open a PDF.

export type PdfCheck =
  | { verdict: "not_pdf" }
  | { verdict: "clean"; pages: number }
  | { verdict: "pictures"; pages: number; firstPage: number | null }
  | { verdict: "unreadable"; reason: string };

/** Bigger files are held for review rather than read in the request. */
export const PDF_CHECK_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_CHECK_MAX_PAGES = 300;
export const PDF_CHECK_BUDGET_MS = 10_000;

/** `%PDF-` within the first 1024 bytes, where the spec allows the header. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return latin1(bytes.subarray(0, Math.min(bytes.length, 1024))).includes("%PDF-");
}

/** Bytes as a string of char codes 0–255 (TextDecoder's "latin1" is windows-1252). */
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

/** A PDF name with its `#xx` escapes decoded. */
function decodeName(name: string): string {
  return name.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

const NAME = "[^\\s/<>[\\]()%{}]+";

/** Detector 1: an image XObject dictionary anywhere in the file body. */
export function hasImageXObject(bytes: Uint8Array): boolean {
  const subtype = new RegExp(`/Subtype\\s*/(${NAME})`, "g");
  const text = latin1(bytes);
  for (let m = subtype.exec(text); m; m = subtype.exec(text)) {
    if (decodeName(m[1]) === "Image") return true;
  }
  return false;
}

/** Names that put a file inside the PDF (detector 4). */
const ATTACHMENT_NAMES = new Set([
  "EmbeddedFile",
  "EmbeddedFiles",
  "EF",
  "FileAttachment",
  "RichMedia",
  "XFA",
]);

/** Detector 4: whether PDF object text names a file carried inside the PDF. */
export function namesAttachedFile(objectText: string): boolean {
  const name = new RegExp(`/(${NAME})`, "g");
  for (let m = name.exec(objectText); m; m = name.exec(objectText)) {
    if (ATTACHMENT_NAMES.has(decodeName(m[1]))) return true;
  }
  return false;
}

function isObjectStream(dict: string): boolean {
  const m = new RegExp(`/Type\\s*/(${NAME})`).exec(dict);
  return !!m && decodeName(m[1]) === "ObjStm";
}

const PICTURE_FILTERS = new Set([
  "DCTDecode",
  "DCT",
  "JPXDecode",
  "JBIG2Decode",
  "CCITTFaxDecode",
  "CCF",
]);
const FLATE = new Set(["FlateDecode", "Fl"]);

/** The dictionary text that ends just before `end` (balanced `<<`/`>>`), or null. */
function dictBefore(text: string, end: number): string | null {
  let depth = 0;
  for (let i = end - 2; i >= 1; i--) {
    if (text[i] === ">" && text[i + 1] === ">") {
      depth++;
      i--;
    } else if (text[i - 1] === "<" && text[i] === "<") {
      depth--;
      if (depth === 0) return text.slice(i + 1, end - 2);
      i--;
    }
  }
  return null;
}

function filtersOf(dict: string): string[] {
  const m = new RegExp(`/Filter\\s*(\\[[^\\]]*\\]|/${NAME})`).exec(dict);
  if (!m) return [];
  return (m[1].match(new RegExp(`/${NAME}`, "g")) ?? []).map((n) => decodeName(n.slice(1)));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An inline image operator sequence: `BI`, its dictionary, then `ID`. */
const INLINE_IMAGE = /(^|[\s\]>)}])BI[\s/][\s\S]*?[\s>\]]ID[\s]/;

/** Detectors 2 and 4: decode every stream, and read the object text around them; see the file comment. */
export async function scanStreams(
  bytes: Uint8Array,
  deadline: number,
  now: () => number,
): Promise<"clean" | "pictures" | { unreadable: string }> {
  const text = latin1(bytes);
  const keyword = /stream\r?\n/g;
  let objectsFrom = 0;
  for (let m = keyword.exec(text); m; m = keyword.exec(text)) {
    if (now() > deadline) return { unreadable: "time_budget" };
    const kwStart = m.index;
    if (text.slice(Math.max(0, kwStart - 3), kwStart) === "end") continue; // "endstream\n"
    const before = text.slice(0, kwStart).trimEnd();
    if (!before.endsWith(">>")) continue;
    const dict = dictBefore(text, before.length);
    if (dict === null) return { unreadable: "stream_dict" };
    if (namesAttachedFile(text.slice(objectsFrom, kwStart))) return { unreadable: "attachments" };

    const dataStart = kwStart + m[0].length;
    const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let dataEnd = direct ? dataStart + Number(direct[1]) : text.indexOf("endstream", dataStart);
    if (dataEnd < dataStart || dataEnd > text.length) return { unreadable: "stream_length" };
    if (!direct) while (dataEnd > dataStart && /[\r\n]/.test(text[dataEnd - 1])) dataEnd--;
    keyword.lastIndex = dataEnd;
    objectsFrom = dataEnd;

    const filters = filtersOf(dict);
    if (filters.some((f) => PICTURE_FILTERS.has(f))) return "pictures";
    let data = bytes.subarray(dataStart, dataEnd);
    for (const f of filters) {
      if (!FLATE.has(f)) return { unreadable: `filter_${f}` };
      try {
        data = await inflate(data);
      } catch {
        return { unreadable: "stream_decode" };
      }
    }
    const decoded = latin1(data);
    if (INLINE_IMAGE.test(decoded)) return "pictures";
    if (isObjectStream(dict) && namesAttachedFile(decoded)) return { unreadable: "attachments" };
  }
  if (namesAttachedFile(text.slice(objectsFrom))) return { unreadable: "attachments" };
  return "clean";
}

export async function checkPdfForPictures(
  bytes: Uint8Array,
  opts: { budgetMs?: number; maxPages?: number; now?: () => number } = {},
): Promise<PdfCheck> {
  if (!looksLikePdf(bytes)) return { verdict: "not_pdf" };
  if (bytes.length > PDF_CHECK_MAX_BYTES) return { verdict: "unreadable", reason: "too_large" };
  if (hasImageXObject(bytes)) return { verdict: "pictures", pages: 0, firstPage: null };

  // A secured PDF (even one that opens without a password) has encrypted
  // streams that can't be decoded here, so it can't be vouched for.
  if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(latin1(bytes))) {
    return { verdict: "unreadable", reason: "encrypted" };
  }

  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? PDF_CHECK_BUDGET_MS);
  const streams = await scanStreams(bytes, deadline, now);
  if (streams === "pictures") return { verdict: "pictures", pages: 0, firstPage: null };
  if (streams !== "clean") return { verdict: "unreadable", reason: streams.unreadable };

  const maxPages = opts.maxPages ?? PDF_CHECK_MAX_PAGES;
  try {
    const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
    const pdfjs = await getResolvedPDFJS();
    const ops = pdfjs.OPS as Record<string, number>;
    const pictureOps = new Set(
      [
        "paintImageXObject",
        "paintImageXObjectRepeat",
        "paintInlineImageXObject",
        "paintInlineImageXObjectGroup",
        "paintImageMaskXObject",
        "paintImageMaskXObjectGroup",
        "paintImageMaskXObjectRepeat",
      ]
        .map((name) => ops[name])
        .filter((code): code is number => typeof code === "number"),
    );
    // getDocumentProxy keeps the buffer; pass a copy so the caller's bytes stay intact.
    const pdf = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: true, verbosity: 0 });
    const pages = pdf.numPages;
    if (pages > maxPages) return { verdict: "unreadable", reason: "too_many_pages" };
    for (let n = 1; n <= pages; n++) {
      if (now() > deadline) return { verdict: "unreadable", reason: "time_budget" };
      const page = await pdf.getPage(n);
      const list = await page.getOperatorList();
      if (list.fnArray.some((fn) => pictureOps.has(fn))) {
        return { verdict: "pictures", pages, firstPage: n };
      }
    }
    return { verdict: "clean", pages };
  } catch (err) {
    return { verdict: "unreadable", reason: err instanceof Error ? err.name : "parse_error" };
  }
}
