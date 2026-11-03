import { useEffect, useState } from "react";
import { Bot, ChevronRight, Heart, Palette, ToggleRight } from "lucide-react";
import { feedbackModeChoices } from "../lib/feedbackModeChoices";
import feedbackLogo from "./image/hospital_logo.png";
import { HOSPITAL } from "../lib/hospital";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
  resetBrandingSettings,
  saveBrandingSettings,
  saveModuleEnabled,
  useModuleEnabled,
} from "../lib/branding";
import type { ModuleFlag } from "../lib/api";
import { CAPABILITY, hasCapability } from "./RouteGuards";
import { Switch } from "./ui/switch";
import { FeedbackQrCard } from "./FeedbackQrCard";

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const validHex = /^#[0-9A-Fa-f]{6}$/.test(value);
  const swatchHex = validHex ? value : "#cccccc";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 flex flex-col gap-3 shadow-sm">
      <label className="relative block w-full h-16 rounded-lg overflow-hidden cursor-pointer ring-1 ring-gray-200 group">
        <span
          className="absolute inset-0 block transition-opacity group-hover:opacity-90"
          style={{ backgroundColor: swatchHex }}
          aria-hidden
        />
        <span className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />
        <span className="absolute bottom-2 left-2 text-xs font-semibold text-white drop-shadow-md">
          Click to pick
        </span>
        <input
          type="color"
          value={validHex ? swatchHex : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
          aria-label={`Pick ${label}`}
        />
      </label>

      <div>
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        {hint ? <p className="text-xs text-gray-500 mt-0.5">{hint}</p> : null}
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="#8B1538"
        className={`w-full font-mono text-sm px-3 py-2 border rounded-lg outline-none uppercase tracking-wide ${
          validHex ? "border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20" : "border-amber-400 bg-amber-50"
        }`}
        spellCheck={false}
      />
    </div>
  );
}

const MODULES: Array<{ flag: ModuleFlag; label: string; description: string }> = [
  {
    flag: "ticketingEnabled",
    label: "Ticketing",
    description:
      "Ticket management, ticket detail, the Tickets insights tab, the HOD queue and the ticket metrics on the Management overview. Feedback is still recorded while this is off, so existing tickets reappear when it is turned back on.",
  },
];

function ModuleSwitchRow({ flag, label, description }: (typeof MODULES)[number]) {
  const { enabled, loaded } = useModuleEnabled(flag);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `module-${flag.replace(/Enabled$/, "")}`;

  async function toggle(next: boolean) {
    try {
      setSaving(true);
      setError(null);
      await saveModuleEnabled(flag, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save module settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-semibold text-gray-800">
            {label}
          </label>
          <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        </div>
        <Switch
          id={id}
          checked={enabled}
          disabled={!loaded || saving}
          onCheckedChange={(next) => void toggle(next)}
          className="mt-1"
        />
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

/** Super Admin only: switches whole modules on or off for every user. Saves on toggle. */
function ModuleSettingsCard() {
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <ToggleRight className="w-5 h-5 text-primary" />
          Modules
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Visible to Super Admins only. Changes apply immediately for everyone, without Save
          settings. Hidden screens keep their data.
        </p>
      </div>
      {MODULES.map((module) => (
        <ModuleSwitchRow key={module.flag} {...module} />
      ))}
    </div>
  );
}

export function AdminSettingsPage() {
  const canManageModules = hasCapability(CAPABILITY.FEATURES_MANAGE);
  const [brandPrimary, setBrandPrimary] = useState("#8B1538");
  const [brandAccent, setBrandAccent] = useState("#C9A227");
  const [brandPageBg, setBrandPageBg] = useState("#FAF7F2");
  const [brandLogoDataUrl, setBrandLogoDataUrl] = useState<string | null>(null);
  const [voiceMaxSeconds, setVoiceMaxSeconds] = useState(120);
  const [botThinkSeconds, setBotThinkSeconds] = useState(3);
  const [botSkipIntro, setBotSkipIntro] = useState(false);
  const [botSkipThinkCountdown, setBotSkipThinkCountdown] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadBrandingSettings().then((next) => {
      if (!alive) return;
      setBrandPrimary(next.primaryColor);
      setBrandAccent(next.accentColor);
      setBrandPageBg(next.pageBackgroundColor);
      setBrandLogoDataUrl(next.logoDataUrl);
      setVoiceMaxSeconds(next.voiceRecordingMaxSeconds);
      setBotThinkSeconds(next.botThinkSeconds);
      setBotSkipIntro(next.botSkipIntro);
      setBotSkipThinkCountdown(next.botSkipThinkCountdown);
    });
    const unsubscribe = onBrandingSettingsChange(() => {
      const updated = getBrandingSettings();
      setBrandPrimary(updated.primaryColor);
      setBrandAccent(updated.accentColor);
      setBrandPageBg(updated.pageBackgroundColor);
      setBrandLogoDataUrl(updated.logoDataUrl);
      setVoiceMaxSeconds(updated.voiceRecordingMaxSeconds);
      setBotThinkSeconds(updated.botThinkSeconds);
      setBotSkipIntro(updated.botSkipIntro);
      setBotSkipThinkCountdown(updated.botSkipThinkCountdown);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  async function saveBranding() {
    if (!/^#[0-9A-Fa-f]{6}$/.test(brandPrimary) || !/^#[0-9A-Fa-f]{6}$/.test(brandAccent) || !/^#[0-9A-Fa-f]{6}$/.test(brandPageBg)) {
      setBannerMessage("Use valid hex colors like #8B1538 for all theme fields.");
      return;
    }
    try {
      setIsSaving(true);
      setBannerMessage(null);
      const secs = Number(voiceMaxSeconds);
      if (!Number.isFinite(secs) || secs < 15 || secs > 600) {
        setBannerMessage("Voice time limit must be between 15 and 600 seconds.");
        return;
      }
      const think = Number(botThinkSeconds);
      if (!Number.isFinite(think) || think < 1 || think > 30) {
        setBannerMessage("Bot think time must be between 1 and 30 seconds.");
        return;
      }
      await saveBrandingSettings({
        primaryColor: brandPrimary,
        accentColor: brandAccent,
        pageBackgroundColor: brandPageBg,
        logoDataUrl: brandLogoDataUrl,
        voiceRecordingMaxSeconds: Math.round(secs),
        botThinkSeconds: Math.round(think),
        botSkipIntro,
        botSkipThinkCountdown,
      });
      setBannerMessage("Settings saved. Employee screens update immediately.");
    } catch {
      setBannerMessage("Failed to save theme. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setLogoError("Please upload an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("Logo size must be under 2MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      setBrandLogoDataUrl(value);
      setLogoError(null);
    };
    reader.onerror = () => {
      setLogoError("Unable to read logo file.");
    };
    reader.readAsDataURL(file);
  }

  function clearCustomLogo() {
    setBrandLogoDataUrl(null);
    setLogoError(null);
  }

  async function restoreDefaultBranding() {
    try {
      setIsSaving(true);
      const defaults = await resetBrandingSettings();
      setBrandPrimary(defaults.primaryColor);
      setBrandAccent(defaults.accentColor);
      setBrandPageBg(defaults.pageBackgroundColor);
      setBrandLogoDataUrl(defaults.logoDataUrl);
      setVoiceMaxSeconds(defaults.voiceRecordingMaxSeconds);
      setBotThinkSeconds(defaults.botThinkSeconds);
      setBotSkipIntro(defaults.botSkipIntro);
      setBotSkipThinkCountdown(defaults.botSkipThinkCountdown);
      setLogoError(null);
      setBannerMessage("Settings reset to defaults.");
    } catch {
      setBannerMessage("Failed to reset theme. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  const previewLogo = brandLogoDataUrl || feedbackLogo;

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-white shrink-0"
            style={{ backgroundColor: brandPrimary }}
          >
            <Palette size={24} />
          </div>
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-800">Settings</h2>
            <p className="text-base text-gray-600 mt-1 max-w-2xl">
              Color theme, voice time limit, and hospital logo for employee screens.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={restoreDefaultBranding}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Reset defaults
          </button>
          <button
            type="button"
            onClick={() => void saveBranding()}
            disabled={isSaving}
            className="px-5 py-2 rounded-lg text-white text-sm font-semibold shadow-md"
            style={{ backgroundColor: brandPrimary }}
          >
            {isSaving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>

      <FeedbackQrCard />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="bg-white rounded-xl shadow-md p-5 md:p-6 space-y-5 min-w-0">
          {bannerMessage ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {bannerMessage}
            </p>
          ) : null}

          {canManageModules ? <ModuleSettingsCard /> : null}

          <div className="rounded-lg border border-gray-200 p-4 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Color theme</h3>
              <p className="text-sm text-gray-600 mt-1">
                Primary color for headings and buttons. Accent is the gradient on the welcome heart.
                Page background is behind the white feedback card.
              </p>
            </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ColorField
              label="Primary color"
              hint="Headings, links, mode icons"
              value={brandPrimary}
              onChange={setBrandPrimary}
            />
            <ColorField
              label="Accent color"
              hint="Welcome heart gradient"
              value={brandAccent}
              onChange={setBrandAccent}
            />
            <ColorField
              label="Page background"
              hint="Behind feedback card"
              value={brandPageBg}
              onChange={setBrandPageBg}
            />
          </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 space-y-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">Voice feedback</h3>
              <p className="text-sm font-semibold text-gray-800 mt-2">Voice time limit</p>
              <p className="text-xs text-gray-500 mt-1">
                Maximum time employees can speak on the voice feedback screen. They see a countdown
                while listening.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="number"
                min={15}
                max={600}
                step={5}
                value={voiceMaxSeconds}
                onChange={(e) => setVoiceMaxSeconds(Number(e.target.value))}
                className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold tabular-nums"
              />
              <span className="text-sm text-gray-600">seconds (15–600)</span>
            </div>
            <p className="text-xs text-gray-500">
              Default: 120 seconds (2 minutes). Listening stops automatically at 0:00.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                AI Voice Guide (bot conversation)
              </h3>
            </div>

            <div className="space-y-2 border-b border-gray-200 pb-4">
              <p className="text-sm font-semibold text-gray-800">Introduction audio</p>
              <p className="text-xs text-gray-500">
                Tamil welcome message played before the first question.
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={botSkipIntro}
                  onChange={(e) => setBotSkipIntro(e.target.checked)}
                />
                Skip intro — go straight to questions
              </label>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-800">Think time before each answer</p>
              <p className="text-xs text-gray-500">
                After each question plays, employees see “சிறிது நேரம் யோசியுங்கள்…” with a countdown
                before the microphone opens.
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={botSkipThinkCountdown}
                  onChange={(e) => setBotSkipThinkCountdown(e.target.checked)}
                />
                Skip think countdown — start recording immediately
              </label>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={botThinkSeconds}
                  disabled={botSkipThinkCountdown}
                  onChange={(e) => setBotThinkSeconds(Number(e.target.value))}
                  className="w-28 px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold tabular-nums disabled:bg-gray-100 disabled:text-gray-400"
                />
                <span className="text-sm text-gray-600">seconds (1–30)</span>
              </div>
              <p className="text-xs text-gray-500">Default: 3 seconds.</p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 bg-gray-50">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Hospital logo</h3>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <img
                src={previewLogo}
                alt="App logo preview"
                className="h-14 w-auto max-w-[200px] object-contain bg-white border border-gray-200 rounded-md px-2 py-1"
              />
              <div className="flex flex-wrap gap-2">
                <label className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-white cursor-pointer">
                  Upload logo
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
                <button
                  type="button"
                  onClick={clearCustomLogo}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-white"
                >
                  Use default logo
                </button>
              </div>
            </div>
            {logoError ? <p className="text-sm text-red-600 mt-2">{logoError}</p> : null}
            <p className="text-xs text-gray-500 mt-2">PNG or JPG up to 2MB. Shown in header and QR poster.</p>
          </div>

        </div>

        <div className="bg-white rounded-xl shadow-md p-4 sm:p-5 md:p-6 lg:sticky lg:top-6 min-w-0">
          <h3 className="text-lg font-semibold text-gray-800">Live preview</h3>
          <p className="mt-0.5 text-sm text-gray-600">How the employee welcome screen looks on a phone.</p>

          {/* A phone showing the welcome screen in the current colours: frame, screen, content. */}
          <div className="mt-5 flex justify-center">
            <div className="w-full max-w-[290px] rounded-[2.25rem] bg-gray-900 p-1.5 shadow-lg">
              <div
                className="overflow-hidden rounded-[1.9rem] px-4 pb-6 pt-2.5 text-center"
                style={{ backgroundColor: brandPageBg }}
              >
                <span className="mx-auto mb-5 block h-1.5 w-16 rounded-full bg-gray-900/80" aria-hidden />
                <div
                  className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${brandPrimary} 0%, ${brandAccent} 100%)` }}
                >
                  <Heart className="h-7 w-7 text-white" fill="white" />
                </div>
                <p className="text-[11px] text-gray-500">Service Completed</p>
                <p className="mt-1 text-base font-bold text-gray-800">Thank you for visiting</p>
                <p className="mt-0.5 text-lg font-bold leading-tight text-balance" style={{ color: brandPrimary }}>
                  {HOSPITAL.name}
                </p>
                <p className="mt-2 text-xs text-gray-600">Your feedback helps us improve care</p>
                <p className="mt-4 text-[11px] font-semibold text-gray-700">How would you like to share feedback?</p>
                <div className="mt-2.5 space-y-2">
                  {feedbackModeChoices.map(({ id, icon: Icon, title, subtitle }) => (
                    <div
                      key={id}
                      className="flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(33,29,26,0.08)]"
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white"
                        style={{ backgroundColor: brandPrimary }}
                      >
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-gray-800">{title}</span>
                        <span className="block text-[11px] text-gray-500">{subtitle}</span>
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-gray-400" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
