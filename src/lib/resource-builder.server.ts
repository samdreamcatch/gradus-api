import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";
import { z } from "zod";
import { PROMPT_INJECTION_GUARD, sanitizeUserContent, wrapUntrusted } from "./ai-prompt-safety";
import { pdfSafe, wrapLines, type BuilderDraft } from "./resource-builder";

const WRITER_MODEL = "claude-sonnet-4-5";

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(600),
  sections: z
    .array(z.object({ heading: z.string().max(200), body: z.string().max(6000) }))
    .min(1)
    .max(12),
});

export type WriteInput = {
  club: string;
  sport: string;
  audience: string;
  title: string;
  brief: string;
};

/** Writes a club handout with Claude. Throws a friendly error when the writer isn't available. */
export async function writeResourceDraft(input: WriteInput): Promise<BuilderDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("The writing assistant isn't set up yet.");
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    apiKey,
    timeout: 60_000,
    maxRetries: 1,
    defaultHeaders: workspace ? { "anthropic-workspace-id": workspace } : undefined,
  });
  const tool: Anthropic.Tool = {
    name: "submit_document",
    description: "Hand back the finished document. Call exactly once.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: {
          type: "string",
          description: "One or two plain sentences on what this document is for.",
        },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              body: {
                type: "string",
                description:
                  "Plain text. Separate paragraphs with a blank line. Use '- ' for list items.",
              },
            },
            required: ["heading", "body"],
          },
        },
      },
      required: ["title", "summary", "sections"],
    },
  };
  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: WRITER_MODEL,
      max_tokens: 4000,
      system:
        "You write clear, practical one-to-four page handouts for youth and adult sports clubs. " +
        "Write in plain, warm, direct language for the named audience. No markdown symbols other than '- ' list items. " +
        "Do not invent phone numbers, addresses, prices, dates or named people; write [placeholder] where the club must fill a fact in. " +
        "For safety, medical or legal topics, keep guidance general and tell readers to follow their governing body and a qualified professional. " +
        PROMPT_INJECTION_GUARD,
      tools: [tool],
      tool_choice: { type: "tool", name: "submit_document" },
      messages: [
        {
          role: "user",
          content: [
            `Club: ${sanitizeUserContent(input.club, 120)}`,
            `Sport: ${input.sport}`,
            `Audience: ${input.audience}`,
            wrapUntrusted("working_title", sanitizeUserContent(input.title, 200)),
            wrapUntrusted("brief", sanitizeUserContent(input.brief, 3000)),
          ].join("\n"),
        },
      ],
    });
  } catch (e) {
    console.error("[resource-builder] Claude request failed", e);
    throw new Error("The writing assistant couldn't be reached. Try again in a minute.");
  }
  const call = res.content.find((c) => c.type === "tool_use");
  const parsed = draftSchema.safeParse(call && "input" in call ? call.input : null);
  if (!parsed.success)
    throw new Error("The writing assistant didn't return a usable draft. Try again.");
  return parsed.data;
}

async function loadLogo(pdf: PDFDocument, url: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
  } catch {
    // A missing or unreadable logo never blocks the document.
  }
  return null;
}

/** Club-branded A4/Letter-friendly PDF: logo + club name header, Tennis rule, page numbers. */
export async function renderResourcePdf(
  draft: BuilderDraft,
  club: { name: string; logoUrl: string | null },
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(draft.title));
  pdf.setAuthor(pdfSafe(club.name));
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const logo = await loadLogo(pdf, club.logoUrl);
  const ink = rgb(0.12, 0.16, 0.22);
  const muted = rgb(0.42, 0.45, 0.5);
  const pen = rgb(0.753, 0.867, 0.153);
  const W = 612,
    H = 792,
    M = 56,
    width = W - M * 2;

  let page = pdf.addPage([W, H]);
  let y = H - M;
  const header = () => {
    let x = M;
    if (logo) {
      const s = 28 / logo.height;
      page.drawImage(logo, { x, y: H - M - 28 + 6, width: logo.width * s, height: 28 });
      x += logo.width * s + 10;
    }
    page.drawText(pdfSafe(club.name), { x, y: H - M - 14, size: 11, font: bold, color: muted });
    page.drawRectangle({ x: M, y: H - M - 34, width, height: 2, color: pen });
    y = H - M - 60;
  };
  header();
  const ensure = (need: number) => {
    if (y - need < M + 24) {
      page = pdf.addPage([W, H]);
      header();
    }
  };
  const block = (text: string, font: typeof body, size: number, color = ink, gap = size * 1.45) => {
    for (const line of wrapLines(pdfSafe(text), width, (s) => font.widthOfTextAtSize(s, size))) {
      ensure(gap);
      if (line) page.drawText(line, { x: M, y, size, font, color });
      y -= gap;
    }
  };

  block(draft.title, serif, 26, ink, 30);
  y -= 4;
  if (draft.summary) {
    block(draft.summary, body, 12, muted);
    y -= 10;
  }
  for (const s of draft.sections) {
    y -= 8;
    ensure(40);
    if (s.heading) {
      block(s.heading, serif, 16, ink, 20);
      y -= 2;
    }
    block(s.body, body, 11);
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) =>
    p.drawText(pdfSafe(`${club.name} - ${i + 1} of ${pages.length}`), {
      x: M,
      y: M - 20,
      size: 9,
      font: body,
      color: muted,
    }),
  );
  return pdf.save();
}
