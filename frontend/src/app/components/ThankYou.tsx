import { useNavigate, useLocation } from "react-router";
import { Check, Home } from "lucide-react";
import { useEffect, useState } from "react";
import { getSession } from "../lib/auth";
import { employeeRoutes } from "../lib/employeeRoutes";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
} from "../lib/branding";
import { hexWithAlpha, mixWithBlack } from "../lib/brandColor";
import { RelievingLetterCard, type RelievingLetterData } from "./RelievingLetter";

export function ThankYou() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromStaffSession = Boolean(location.state?.fromStaffSession);
  const aiSentiment = location.state?.aiSentiment as
    | "positive"
    | "neutral"
    | "negative"
    | null
    | undefined;
  const aiSummary = typeof location.state?.aiSummary === "string" ? location.state.aiSummary : "";
  const aiTopics = Array.isArray(location.state?.aiTopics)
    ? (location.state.aiTopics as string[])
    : [];
  const voiceUploadWarning =
    typeof location.state?.voiceUploadWarning === "string"
      ? location.state.voiceUploadWarning
      : "";
  const staffRemarksSubmitted =
    typeof location.state?.staffRemarks === "string" ? location.state.staffRemarks : "";
  const offlineQueued = Boolean(location.state?.offlineQueued);
  const relievingLetter = (location.state?.relievingLetter ?? null) as RelievingLetterData | null;
  const session = getSession();
  const isStaffSession = fromStaffSession || session?.role === "staff";

  const [primaryColor, setPrimaryColor] = useState("#DC1A1F");

  useEffect(() => {
    void loadBrandingSettings().then((c) => setPrimaryColor(c.primaryColor));
    return onBrandingSettingsChange(() => {
      setPrimaryColor(getBrandingSettings().primaryColor);
    });
  }, []);

  const successGlow = hexWithAlpha(primaryColor, 0.42);
  const aiPanelBg = hexWithAlpha(primaryColor, 0.08);
  const googleBand = {
    backgroundColor: hexWithAlpha(primaryColor, 0.1),
    borderColor: hexWithAlpha(primaryColor, 0.32),
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center px-4">
      <div className="bg-white rounded-3xl shadow-xl p-8 md:p-12 max-w-2xl w-full border border-gray-100">
        <div className="mb-8">
          <div
            className="w-28 h-28 md:w-32 md:h-32 mx-auto rounded-full flex items-center justify-center animate-in zoom-in duration-500 text-white"
            style={{
              backgroundColor: primaryColor,
              boxShadow: `0 10px 36px ${successGlow}`,
            }}
          >
            <Check size={54} strokeWidth={3.5} />
          </div>
        </div>

        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">Your feedback has been received</h2>

        <p className="text-lg md:text-xl text-gray-600 mb-9 leading-relaxed">
          Thank you for helping us make this a better place to work
        </p>

        {relievingLetter ? <RelievingLetterCard data={relievingLetter} primaryColor={primaryColor} /> : null}

        {offlineQueued && (
          <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your feedback is saved on this device. It will finish uploading automatically when the connection
            is stable — you can close this page safely.
          </p>
        )}

        {voiceUploadWarning.trim() && (
          <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {voiceUploadWarning.trim()}
          </p>
        )}

        {staffRemarksSubmitted.trim() && (
          <div className="mb-8 rounded-2xl border border-gray-200 bg-gray-50/80 px-5 py-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Remark
            </p>
            <p className="text-base text-gray-800 leading-relaxed whitespace-pre-wrap">
              {staffRemarksSubmitted.trim()}
            </p>
          </div>
        )}

        {isStaffSession && aiSummary.trim() && (
          <div
            className="mb-8 rounded-2xl px-5 py-4 text-left border-2"
            style={{ backgroundColor: aiPanelBg, borderColor: hexWithAlpha(primaryColor, 0.28) }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-2"
              style={{ color: mixWithBlack(primaryColor, 0.2) }}
            >
              Quick insight (AI summary)
            </p>
            <p className="text-base text-gray-900 leading-relaxed">{aiSummary.trim()}</p>
            {aiTopics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {aiTopics.slice(0, 5).map((t) => (
                  <span
                    key={t}
                    className="rounded-md bg-white px-2 py-1 text-xs text-gray-800 shadow-sm border"
                    style={{ borderColor: hexWithAlpha(primaryColor, 0.2) }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}


        <button
          type="button"
          onClick={() => navigate(employeeRoutes.home)}
          className="w-full text-white text-xl md:text-2xl py-5 md:py-6 rounded-2xl font-bold shadow-lg hover:shadow-xl hover:scale-[1.01] transition-all duration-200 flex items-center justify-center gap-3"
          style={{ backgroundColor: primaryColor }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = primaryColor;
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = mixWithBlack(primaryColor, 0.12);
          }}
        >
          <Home size={28} />
          {isStaffSession ? "Next employee feedback" : "Next feedback"}
        </button>
      </div>

      <p className="mt-6 text-sm text-gray-500">Instant acknowledgement — no delays</p>
    </div>
  );
}
