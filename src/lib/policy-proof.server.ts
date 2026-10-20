import { PDFDocument, StandardFonts } from "pdf-lib";

export type ProofInput = {
  club: string;
  title: string;
  version: number;
  audiences: string[];
  dueAt: string | null;
  requiredAt: string;
  sourceUrl: string | null;
  signers: { name: string; role: string; forAthleteName: string | null; signedBy: string | null; acknowledgedAt: string | null }[];
  history: { version: number; signer_name: string; role: string; acknowledged_at: string; acted_for_athlete_id: string | null }[];
  versions: { version: number; title: string; audiences: string[]; required_at: string; external_url: string | null }[];
  original?: Uint8Array;
};

/** Evidence export uses embedded standard fonts and bytes, with no filesystem dependency. */
export async function buildPolicyProof(input: ProofInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const heading = await pdf.embedFont(StandardFonts.TimesRomanBold);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  // Standard PDF fonts have a limited character set; preserve available glyphs without crashing exports.
  const safe = (value: string) => Array.from(value).map((c) => {
    try { font.encodeText(c); return c; } catch { return "?"; }
  }).join("");
  const line = (value: string, title = false) => {
    const text = safe(value);
    const size = title ? 18 : 10;
    const face = title ? heading : font;
    const words = text.split(/\s+/);
    let current = "";
    const draw = (chunk: string) => {
      if (y < 55) { page = pdf.addPage([595, 842]); y = 790; }
      page.drawText(chunk, { x: 45, y, size, font: face });
      y -= title ? 26 : 16;
    };
    for (let word of words) {
      while (face.widthOfTextAtSize(word, size) > 505) {
        let cut = word.length - 1;
        while (cut > 1 && face.widthOfTextAtSize(word.slice(0, cut), size) > 505) cut--;
        if (current) { draw(current); current = ""; }
        draw(word.slice(0, cut)); word = word.slice(cut);
      }
      const next = current ? `${current} ${word}` : word;
      if (face.widthOfTextAtSize(next, size) > 505) { draw(current); current = word; }
      else current = next;
    }
    if (current) draw(current);
  };
  line("Gradus - Policy records", true);
  line(input.club, true);
  line(input.title, true);
  line(`Version: ${input.version} | Audience: ${input.audiences.join(", ")}`);
  line(`Required: ${input.requiredAt} | Due: ${input.dueAt ?? "No deadline"}`);
  line(`Exported: ${new Date().toISOString()}`);
  if (input.sourceUrl) line(`Document source: ${input.sourceUrl}`);
  line("Current sign-offs", true);
  for (const s of input.signers) {
    line(`${s.name} | ${s.role}${s.forAthleteName ? ` | guardian for ${s.forAthleteName}` : ""} | ${s.acknowledgedAt ?? "Outstanding"}${s.signedBy ? ` | signed by ${s.signedBy}` : ""}`);
  }
  if (!input.signers.length) line("No applicable people recorded.");
  line("Document versions", true);
  for (const v of input.versions) line(`v${v.version} | ${v.title} | ${v.audiences.join(", ")} | ${v.required_at}${v.external_url ? ` | ${v.external_url}` : ""}`);
  line("Earlier sign-offs", true);
  for (const h of input.history) line(`v${h.version} | ${h.signer_name} | ${h.role} | ${h.acknowledged_at}${h.acted_for_athlete_id ? ` | guardian for athlete ${h.acted_for_athlete_id}` : ""}`);
  if (!input.history.length) line("No earlier sign-offs recorded.");
  if (input.original) {
    const original = await PDFDocument.load(input.original);
    const pages = await pdf.copyPages(original, original.getPageIndices());
    for (const p of pages) pdf.addPage(p);
  }
  return pdf.save();
}