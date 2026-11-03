import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { HOSPITAL } from "../lib/hospital";
import { employeeRoutes } from "../lib/employeeRoutes";

/** Where the QR code sends employees: this site's welcome screen. */
function feedbackQrTarget(): string {
  return `${window.location.origin}${employeeRoutes.home}`;
}

/** Feedback QR code for this deployment, generated from the site address, with a print-size download. */
export function FeedbackQrCard() {
  const target = feedbackQrTarget();
  const [preview, setPreview] = useState<string | null>(null);
  const [print, setPrint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      QRCode.toDataURL(target, { width: 440, margin: 2, errorCorrectionLevel: "M" }),
      QRCode.toDataURL(target, { width: 2000, margin: 4, errorCorrectionLevel: "M" }),
    ])
      .then(([small, large]) => {
        if (cancelled) return;
        setPreview(small);
        setPrint(large);
      })
      .catch(() => {
        if (cancelled) return;
        setPreview(null);
        setPrint(null);
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  return (
    <div className="rounded-2xl border-2 border-brand-gold bg-gradient-to-br from-[#FFFBF7] via-[#FFF8F0] to-[#FFF0F0] p-4 sm:p-6 shadow-md">
      <h3 className="text-lg font-bold text-primary mb-1">Feedback QR Code</h3>
      <p className="text-sm text-[#6b1229] mb-5">
        Employees scan this to open the feedback form. Download the print-quality file for posters,
        notice boards and WhatsApp.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6">
        {preview ? (
          <img
            src={preview}
            alt={`${HOSPITAL.name} employee feedback QR code`}
            width={220}
            height={220}
            className="mx-auto sm:mx-0 h-auto w-full max-w-[220px] shrink-0 rounded-xl bg-white shadow-md ring-2 ring-primary/20"
          />
        ) : (
          <div className="mx-auto sm:mx-0 grid h-[220px] w-[220px] shrink-0 place-items-center rounded-xl bg-white text-sm text-gray-500 ring-2 ring-primary/20">
            Generating…
          </div>
        )}
        <div className="space-y-3 text-center sm:text-left flex-1 min-w-0">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Scan target</p>
          <p className="text-sm text-[#4a0d18] break-all font-mono bg-white/70 rounded-lg px-3 py-2 border border-brand-gold/30">
            {target}
          </p>
          {print ? (
            <a
              href={print}
              download={`${HOSPITAL.shortName.toLowerCase()}-employee-feedback-qr.png`}
              className="inline-flex px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-[#6f1029] transition-colors shadow-sm ring-1 ring-brand-gold/40"
            >
              Download QR (print quality)
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
