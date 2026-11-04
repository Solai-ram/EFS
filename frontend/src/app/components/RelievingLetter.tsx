import { useState } from "react";
import { FileText } from "lucide-react";
import defaultLogo from "./image/hospital_logo.png";
import { getBrandingSettings } from "../lib/branding";
import { HOSPITAL } from "../lib/hospital";
import { RELIEVING_LETTER_TEMPLATE as T } from "../lib/relievingLetterTemplate";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export type RelievingLetterData = {
  employeeName: string;
  employeeId: string;
  department: string;
  dateOfJoining: string;
  lastWorkingDay: string;
};

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "2026-11-10" -> "10 November 2026". Falls back to the raw text for anything unexpected. */
function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m) return value || "-";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * The letter as a complete, print-ready HTML page. It is shown in an iframe and printed from there,
 * so the preview and the printout are always the same document. The wording comes from
 * lib/relievingLetterTemplate.ts (currently a temporary draft).
 */
export function buildRelievingLetterHtml(data: RelievingLetterData, logoUrl: string): string {
  const values: Record<string, string> = {
    name: data.employeeName.trim() || "Employee",
    employeeId: data.employeeId.trim() || "-",
    department: data.department.trim() || "-",
    dateOfJoining: formatDate(data.dateOfJoining),
    lastWorkingDay: formatDate(data.lastWorkingDay),
    date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    hospital: HOSPITAL.name,
  };
  // Escape first, then fill: an employee typing markup into their name can never inject HTML.
  const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => escapeHtml(values[key] ?? ""));
  const lines = (list: readonly string[]) => list.map(fill).join("<br>");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(T.title)} - ${escapeHtml(values.name)}</title>
<style>
  @page { size: A4; margin: 18mm 20mm; }
  * { box-sizing: border-box; }
  /* View only: no text selection, and the page prints blank if someone tries. */
  html, body { -webkit-user-select: none; user-select: none; }
  @media print { body { display: none !important; } }
  .wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); font-size: 150px; font-weight: 700; letter-spacing: .12em; color: rgba(200, 22, 27, .09); pointer-events: none; z-index: 0; }
  .draft { background: #fff4d6; border: 1px solid #f0c15a; color: #7a4b00; font-family: Arial, sans-serif; font-size: 12px; font-weight: 700; text-align: center; padding: 8px 12px; border-radius: 6px; margin-bottom: 22px; }
  .page { position: relative; z-index: 1; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; line-height: 1.6; font-size: 14px; margin: 0; padding: 28px 36px; }
  .head { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #c8161b; padding-bottom: 14px; margin-bottom: 26px; }
  .head img { height: 84px; width: auto; }
  .head h1 { font-size: 22px; margin: 0; letter-spacing: .02em; }
  .head p { margin: 2px 0 0; font-size: 12px; color: #555; }
  h2 { text-align: center; font-size: 18px; letter-spacing: .12em; text-transform: uppercase; margin: 8px 0 24px; }
  table { border-collapse: collapse; margin: 14px 0 18px; }
  td { padding: 3px 18px 3px 0; vertical-align: top; }
  td:first-child { color: #555; }
  .sign { margin-top: 56px; }
  .note { margin-top: 36px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 11px; color: #666; }
</style></head>
<body>
  <div class="wm">${escapeHtml(T.watermark)}</div>
  <div class="page">
  <div class="draft">${escapeHtml(T.draftNotice)}</div>
  <div class="head">
    <img src="${escapeHtml(logoUrl)}" alt="">
    <div><h1>${escapeHtml(values.hospital)}</h1><p>${escapeHtml(T.department)}</p></div>
  </div>
  <h2>${escapeHtml(T.title)}</h2>
  <p>Date: ${escapeHtml(values.date)}</p>
  <p>To,<br><strong>${escapeHtml(values.name)}</strong></p>
  <table>
    ${T.details.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td><strong>${fill(row.value)}</strong></td></tr>`).join("\n    ")}
  </table>
  <p>${fill(T.greeting)}</p>
  ${T.paragraphs.map((text) => `<p>${fill(text)}</p>`).join("\n  ")}
  <p class="sign">${lines(T.closing)}<br><br><br><strong>${fill(T.signature[0] ?? "")}</strong><br>${lines(T.signature.slice(1))}</p>
  <p class="note">${fill(T.footerNote)}</p>
  </div>
</body></html>`;
}

/** The "your relieving letter is ready" card on the thank-you page, with a preview and print dialog. */
export function RelievingLetterCard({ data, primaryColor }: { data: RelievingLetterData; primaryColor: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="mb-8 rounded-2xl border-2 p-5 text-left md:p-6"
        style={{ borderColor: `${primaryColor}40`, backgroundColor: `${primaryColor}0D` }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white"
            style={{ backgroundColor: primaryColor }}
            aria-hidden="true"
          >
            <FileText size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-gray-900">Your relieving letter</p>
            <p className="mt-0.5 text-sm leading-relaxed text-gray-600">
              Thank you for completing your exit interview. You can view a draft of your relieving letter here. Please get the approved copy from HR.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl px-5 py-3 text-base font-semibold text-white shadow-sm hover:brightness-110"
            style={{ backgroundColor: primaryColor }}
          >
            View relieving letter
          </button>
        </div>
      </div>

      <RelievingLetterDialog data={data} open={open} onOpenChange={setOpen} primaryColor={primaryColor} />
    </>
  );
}

/** View-only preview of the draft letter. There is deliberately no print or download button. */
export function RelievingLetterDialog({
  data,
  open,
  onOpenChange,
}: {
  data: RelievingLetterData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryColor?: string;
}) {
  const logo = getBrandingSettings().logoDataUrl || defaultLogo;
  const logoUrl = logo.startsWith("data:") ? logo : new URL(logo, window.location.href).href;
  const html = open ? buildRelievingLetterHtml(data, logoUrl) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Relieving letter (draft)</DialogTitle>
          <DialogDescription>This draft is for viewing only. Please get the approved copy from HR.</DialogDescription>
        </DialogHeader>
        <iframe
          title="Relieving letter"
          srcDoc={html}
          sandbox=""
          className="h-[60vh] w-full rounded-lg border border-gray-200 bg-white"
        />
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Get the approved copy from HR.
        </p>
      </DialogContent>
    </Dialog>
  );
}
