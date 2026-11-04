import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Heart } from "lucide-react";
import { getSession } from "../lib/auth";
import { employeeRoutes } from "../lib/employeeRoutes";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
} from "../lib/branding";
import { FeedbackModeCards } from "./FeedbackModeCards";
import { HOSPITAL } from "../lib/hospital";

/** General feedback: choose AI voice guide, voice recording, or typed rating. */
export function GeneralFeedbackMode() {
  const navigate = useNavigate();
  const session = getSession();
  const [primaryColor, setPrimaryColor] = useState("#DC1A1F");
  const [accentColor, setAccentColor] = useState("#F7A014");

  useEffect(() => {
    void loadBrandingSettings().then((c) => {
      setPrimaryColor(c.primaryColor);
      setAccentColor(c.accentColor);
    });
    return onBrandingSettingsChange(() => {
      const c = getBrandingSettings();
      setPrimaryColor(c.primaryColor);
      setAccentColor(c.accentColor);
    });
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[75vh] text-center sm:px-4">
      <div className="bg-white rounded-3xl shadow-lg px-5 py-7 sm:p-8 md:p-12 max-w-4xl w-full">
        <div className="mb-6 sm:mb-8">
          <div
            className="w-24 h-24 sm:w-32 sm:h-32 mx-auto mb-5 sm:mb-6 rounded-full flex items-center justify-center shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
            }}
          >
            <Heart className="w-12 h-12 sm:w-16 sm:h-16 text-white" fill="white" />
          </div>
          {session?.role === "staff" ? (
            <div className="text-sm text-gray-500 mb-2">Staff — general feedback</div>
          ) : (
            <div className="text-sm text-gray-500 mb-2">General feedback</div>
          )}
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 sm:mb-3 text-gray-800">Your voice matters</h1>
        <h2 className="text-[1.7rem] sm:text-3xl md:text-[2.6rem] font-bold leading-tight tracking-tight mb-4 text-balance" style={{ color: primaryColor }}>
          {HOSPITAL.name}
        </h2>

        <p className="text-base sm:text-lg md:text-xl text-gray-600 mb-6 sm:mb-8 leading-relaxed">
          Your feedback helps us make this a better place to work
        </p>

        <p className="text-sm font-semibold text-gray-700 mb-4">How would you like to share your feedback?</p>

        <FeedbackModeCards primaryColor={primaryColor} />

        {session && (
          <button
            type="button"
            onClick={() => navigate(employeeRoutes.mode)}
            className="text-sm font-medium underline-offset-4 hover:underline"
            style={{ color: primaryColor }}
          >
            ← Back to feedback types
          </button>
        )}
      </div>
    </div>
  );
}
