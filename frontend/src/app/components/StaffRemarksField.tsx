interface FeedbackRemarkFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function FeedbackRemarkField({ value, onChange }: FeedbackRemarkFieldProps) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-800 mb-0.5">
        Remark <span className="font-normal text-gray-400">(optional)</span>
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Any extra note to include with this feedback. Leave blank if not needed.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Collected at the desk, employee needed assistance…"
        className="w-full h-24 px-4 py-3 text-sm text-gray-900 border border-gray-300 rounded-xl outline-none resize-none bg-white transition placeholder:text-gray-400 focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
    </div>
  );
}

/** @deprecated use FeedbackRemarkField */
export const StaffRemarksField = FeedbackRemarkField;
