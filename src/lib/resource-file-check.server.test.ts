import { describe, expect, it } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  checkPdfForPictures,
  hasImageXObject,
  looksLikePdf,
  namesAttachedFile,
} from "./resource-file-check.server";

/** A minimal PDF: objects 1 (catalog), 2 (pages), 3 (page), 4 (content), extras from 5. */
function buildPdf(
  content: Uint8Array | string,
  opts: { resources?: string; extra?: (string | Uint8Array)[]; contentDict?: string } = {},
): Uint8Array {
  const enc = new TextEncoder();
  const body = typeof content === "string" ? enc.encode(content) : content;
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.4\n");
  const objects: (string | Uint8Array)[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> ${opts.resources ?? ""} >> >>`,
    ],
    [`<< /Length ${body.length} ${opts.contentDict ?? ""}>>\nstream\n`, body, "\nendstream"],
    ...(opts.extra ?? []).map((e) => [e]),
  ];
  objects.forEach((obj, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n`);
    obj.forEach(push);
    push("\nendobj\n");
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((o) => push(`${String(o).padStart(10, "0")} 00000 n \n`));
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const pixels = new Uint8Array(12).fill(200); // 2×2 RGB
const imageObject = (subtype = "/Image") => {
  const enc = new TextEncoder();
  const head = enc.encode(
    `<< /Type /XObject /Subtype ${subtype} /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n`,
  );
  const tail = enc.encode("\nendstream");
  const out = new Uint8Array(head.length + pixels.length + tail.length);
  out.set(head, 0);
  out.set(pixels, head.length);
  out.set(tail, head.length + pixels.length);
  return out;
};

describe("coach PDF picture check", () => {
  it("passes a text-only PDF and a vector drawing", async () => {
    expect(
      await checkPdfForPictures(buildPdf("BT /F1 12 Tf 20 100 Td (Edge drill) Tj ET")),
    ).toEqual({
      verdict: "clean",
      pages: 1,
    });
    expect(await checkPdfForPictures(buildPdf("2 w 10 10 m 150 150 l S 20 20 80 40 re f"))).toEqual(
      {
        verdict: "clean",
        pages: 1,
      },
    );
  });

  it("holds a PDF with an image XObject, even when the page never draws it", async () => {
    const drawn = buildPdf("q 100 0 0 100 0 0 cm /Im1 Do Q", {
      resources: "/XObject << /Im1 5 0 R >>",
      extra: [imageObject()],
    });
    expect((await checkPdfForPictures(drawn)).verdict).toBe("pictures");
    const unused = buildPdf("BT /F1 12 Tf 20 100 Td (No picture drawn) Tj ET", {
      extra: [imageObject()],
    });
    expect((await checkPdfForPictures(unused)).verdict).toBe("pictures");
  });

  it("decodes escaped names, so /Im#61ge is still an image", () => {
    const pdf = buildPdf("q /Im1 Do Q", {
      resources: "/XObject << /Im1 5 0 R >>",
      extra: [imageObject("/Im#61ge")],
    });
    expect(hasImageXObject(pdf)).toBe(true);
  });

  it("holds an inline image inside a compressed content stream", async () => {
    const enc = new TextEncoder();
    const raw = new Uint8Array([
      ...enc.encode("q 100 0 0 100 0 0 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID "),
      ...pixels,
      ...enc.encode(" EI Q"),
    ]);
    const pdf = buildPdf(new Uint8Array(deflateSync(raw)), {
      contentDict: "/Filter /FlateDecode ",
    });
    expect(hasImageXObject(pdf)).toBe(false); // invisible to the raw scan
    expect((await checkPdfForPictures(pdf)).verdict).toBe("pictures");
  });

  it("holds a page whose content can't be decoded instead of calling it clean", async () => {
    const garbage = new Uint8Array(64).fill(0x41);
    const pdf = buildPdf(garbage, { contentDict: "/Filter /FlateDecode " });
    expect((await checkPdfForPictures(pdf)).verdict).toBe("unreadable");
  });

  it("holds a picture drawn inside a form XObject", async () => {
    const enc = new TextEncoder();
    const formContent = enc.encode("q 50 0 0 50 0 0 cm BI /W 2 /H 2 /CS /RGB /BPC 8 ID ");
    const tail = enc.encode(" EI Q");
    const formBody = new Uint8Array([...formContent, ...pixels, ...tail]);
    const formHead = enc.encode(
      `<< /Type /XObject /Subtype /Form /BBox [0 0 100 100] /Length ${formBody.length} >>\nstream\n`,
    );
    const form = new Uint8Array([...formHead, ...formBody, ...enc.encode("\nendstream")]);
    const pdf = buildPdf("q /Fm1 Do Q", { resources: "/XObject << /Fm1 5 0 R >>", extra: [form] });
    expect((await checkPdfForPictures(pdf)).verdict).toBe("pictures");
  });

  it("holds a picture codec, and a filter it can't decode", async () => {
    const jpegStream = buildPdf("q Q", {
      extra: ["<< /Length 4 /Filter /DCTDecode >>\nstream\nabcd\nendstream"],
    });
    expect((await checkPdfForPictures(jpegStream)).verdict).toBe("pictures");
    const lzw = buildPdf("q Q", {
      extra: ["<< /Length 4 /Filter /LZWDecode >>\nstream\nabcd\nendstream"],
    });
    expect(await checkPdfForPictures(lzw)).toEqual({
      verdict: "unreadable",
      reason: "filter_LZWDecode",
    });
  });

  it("holds a PDF that carries an attached file, which no page draws", async () => {
    const enc = new TextEncoder();
    const photo = deflateSync(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...pixels]));
    const file = new Uint8Array([
      ...enc.encode(
        `<< /Type /EmbeddedFile /Filter /FlateDecode /Length ${photo.length} >>\nstream\n`,
      ),
      ...photo,
      ...enc.encode("\nendstream"),
    ]);
    const attached = buildPdf("BT /F1 12 Tf (x) Tj ET", {
      extra: [file, "<< /Type /Filespec /F (athlete.jpg) /EF << /F 5 0 R >> >>"],
    });
    expect(hasImageXObject(attached)).toBe(false);
    expect(await checkPdfForPictures(attached)).toEqual({
      verdict: "unreadable",
      reason: "attachments",
    });
  });

  it("finds an attachment behind an escaped name or inside an object stream", async () => {
    const annotation = buildPdf("BT /F1 12 Tf (x) Tj ET", {
      extra: ["<< /Type /Annot /Subtype /FileAtt#61chment /Rect [0 0 10 10] >>"],
    });
    expect(namesAttachedFile("<< /Subtype /FileAtt#61chment >>")).toBe(true);
    expect((await checkPdfForPictures(annotation)).verdict).toBe("unreadable");

    const enc = new TextEncoder();
    const objects = deflateSync(enc.encode("6 0 << /Type /Filespec /EF << /F 7 0 R >> >>"));
    const objStm = new Uint8Array([
      ...enc.encode(
        `<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${objects.length} >>\nstream\n`,
      ),
      ...objects,
      ...enc.encode("\nendstream"),
    ]);
    const packed = buildPdf("BT /F1 12 Tf (x) Tj ET", { extra: [objStm] });
    expect(await checkPdfForPictures(packed)).toEqual({
      verdict: "unreadable",
      reason: "attachments",
    });
  });

  it("doesn't read attachment names out of stream data", async () => {
    // Page text that happens to spell /EF is data, not a dictionary.
    const pdf = buildPdf("BT /F1 12 Tf (/EF /XFA) Tj ET");
    expect((await checkPdfForPictures(pdf)).verdict).toBe("clean");
  });

  it("holds a secured PDF", async () => {
    const pdf = new TextDecoder().decode(buildPdf("BT /F1 12 Tf (x) Tj ET"));
    const secured = new TextEncoder().encode(
      pdf.replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 9 0 R"),
    );
    expect(await checkPdfForPictures(secured)).toEqual({
      verdict: "unreadable",
      reason: "encrypted",
    });
  });

  it("refuses bytes that aren't a PDF, and tells a renamed JPEG apart", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
    expect(looksLikePdf(jpeg)).toBe(false);
    expect(await checkPdfForPictures(jpeg)).toEqual({ verdict: "not_pdf" });
  });

  it("holds what it can't read with confidence", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf");
    expect((await checkPdfForPictures(broken)).verdict).toBe("unreadable");
    const many = buildPdf("BT /F1 12 Tf (x) Tj ET");
    expect(await checkPdfForPictures(many, { maxPages: 0 })).toEqual({
      verdict: "unreadable",
      reason: "too_many_pages",
    });
    let t = 0;
    expect(await checkPdfForPictures(many, { budgetMs: 5, now: () => (t += 10) })).toEqual({
      verdict: "unreadable",
      reason: "time_budget",
    });
  });
});
