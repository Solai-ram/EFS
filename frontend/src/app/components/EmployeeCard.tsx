import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Clock, Info } from "lucide-react";

/** Shared building blocks for the employee feedback screens (form, voice, bot). */

export function EmployeeCard({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(24_18_18/0.04),0_12px_32px_-12px_rgb(24_18_18/0.12)]">
      <div className="border-b border-gray-100 px-6 pb-5 pt-6 md:px-10 md:pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9A5B00]">{kicker}</p>
        <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-gray-900 md:text-[1.75rem]">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-sm leading-relaxed text-gray-500 md:text-[15px]">{subtitle}</p> : null}
      </div>
      <div className="px-6 py-6 md:px-10 md:py-8">{children}</div>
    </div>
  );
}

export function StepHeading({
  step,
  title,
  hint,
  primaryColor,
}: {
  step: number;
  title: string;
  hint?: ReactNode;
  primaryColor: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
        style={{ backgroundColor: primaryColor }}
      >
        {step}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold leading-6 tracking-normal text-gray-900">{title}</h3>
        {hint ? <p className="text-sm leading-relaxed text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Neutral guidance line; turns into a confirmation when `ready`. */
export function StatusNote({
  ready = false,
  primaryColor,
  children,
}: {
  ready?: boolean;
  primaryColor: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
        ready ? "text-gray-800" : "border-gray-200 bg-gray-50 text-gray-600"
      }`}
      style={ready ? { borderColor: `${primaryColor}33`, backgroundColor: `${primaryColor}0A` } : undefined}
    >
      {ready ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primaryColor }} />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PrimaryAction({
  primaryColor,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { primaryColor: string }) {
  const enabled = !props.disabled;
  return (
    <button
      type="button"
      {...props}
      className={`flex h-14 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold transition-all md:text-lg ${
        enabled
          ? "text-white shadow-[0_8px_20px_-8px_rgb(24_18_18/0.45)] hover:brightness-110 active:translate-y-px"
          : "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400"
      } ${className}`}
      style={enabled ? { backgroundColor: primaryColor } : undefined}
    >
      {children}
    </button>
  );
}

export function EmployeeFooter({
  onBack,
  timing,
}: {
  onBack: () => void;
  /** Short note such as "Takes about 5 minutes". Omit to hide. */
  timing?: string;
}) {
  return (
    <div className="mt-6 flex flex-col items-center gap-3 text-sm">
      {timing ? (
        <p className="inline-flex items-center gap-1.5 text-gray-500">
          <Clock className="h-3.5 w-3.5" />
          {timing}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium text-gray-600 transition hover:bg-white hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Choose a different feedback type
      </button>
    </div>
  );
}
