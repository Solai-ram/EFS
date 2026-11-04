import { Mic } from "lucide-react";
import { useState } from "react";
import type { BotConversationAnswer } from "../lib/api";
import { resolveUploadUrl } from "../lib/api";
import { VoiceAudioPlayer } from "./VoiceAudioPlayer";

function answerAudioSrc(url: string | null | undefined): string | null {
  return resolveUploadUrl(url ?? null);
}

function AnswerVoiceAudio({ src }: { src: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1 flex items-center gap-1">
        <Mic size={14} />
        Voice audio
      </p>
      <VoiceAudioPlayer src={src} className="w-full" onUnavailable={() => setVisible(false)} />
    </div>
  );
}

function SessionVoiceAudio({ src, cardPad }: { src: string; cardPad: string }) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className={`rounded-lg border border-gray-200 bg-gray-50 ${cardPad}`}>
      <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2 flex items-center gap-1">
        <Mic size={14} />
        Combined session audio
      </p>
      <VoiceAudioPlayer src={src} onUnavailable={() => setVisible(false)} />
    </div>
  );
}

type BotConversationFeedbackSectionProps = {
  answers: BotConversationAnswer[];
  combinedSessionUrl?: string | null;
  fullTranscript?: string | null;
  /** Shown on split-issue tickets when voice Q&A comes from the parent submission */
  groupNote?: string | null;
  compact?: boolean;
};

export function BotConversationFeedbackSection({
  answers,
  combinedSessionUrl,
  fullTranscript,
  groupNote,
  compact = false,
}: BotConversationFeedbackSectionProps) {
  const sorted = [...answers].sort((a, b) => a.questionOrder - b.questionOrder);
  const sessionSrc = answerAudioSrc(combinedSessionUrl);

  if (!sorted.length) {
    return (
      <p className="text-sm text-amber-700 rounded-lg border border-amber-100 bg-amber-50 p-3">
        Bot conversation was submitted but no question answers are stored for this feedback.
      </p>
    );
  }

  const cardPad = compact ? "p-3 space-y-2" : "p-4 space-y-3";
  const titleClass = compact
    ? "text-xs font-semibold text-gray-500 uppercase tracking-wide"
    : "text-sm font-bold text-gray-800 uppercase tracking-wide";

  return (
    <div className="space-y-4">
      {groupNote ? (
        <p className="text-sm text-primary font-medium rounded-lg border border-primary/20 bg-brand-50/60 px-3 py-2">
          {groupNote}
        </p>
      ) : null}

      <p className={titleClass}>Conversation — questions, speech-to-text & voice answers</p>

      {sorted.map((row) => {
        const answerSrc = answerAudioSrc(row.audioUrl);
        return (
          <div
            key={row.questionOrder}
            className={`rounded-lg border border-gray-200 bg-gray-50 ${cardPad}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className={`font-semibold text-gray-800 ${compact ? "text-sm" : "text-sm"}`}>
                {row.questionText}
              </p>
              {row.answerSentiment ? (
                <span className="text-xs px-2 py-0.5 rounded-md bg-white border capitalize text-gray-700">
                  {row.answerSentiment}
                </span>
              ) : null}
            </div>
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
                Speech-to-text
              </p>
              <p
                className={`text-gray-800 leading-relaxed whitespace-pre-wrap ${
                  compact ? "text-sm" : "text-sm"
                }`}
              >
                {row.transcript?.trim() || "—"}
              </p>
            </div>
            {answerSrc ? <AnswerVoiceAudio src={answerSrc} /> : null}
          </div>
        );
      })}

      {sessionSrc ? <SessionVoiceAudio src={sessionSrc} cardPad={cardPad} /> : null}

      {fullTranscript?.trim() ? (
        <details className="rounded-lg border border-gray-100 bg-white p-3 text-sm">
          <summary className="font-semibold text-gray-600 cursor-pointer">
            Full conversation log (stored text)
          </summary>
          <p className="mt-2 text-gray-700 whitespace-pre-wrap text-xs leading-relaxed">
            {fullTranscript}
          </p>
        </details>
      ) : null}
    </div>
  );
}
