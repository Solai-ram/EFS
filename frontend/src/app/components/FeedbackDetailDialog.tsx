import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import type { FeedbackItem } from "../lib/api";
import { getFeedbackById, resolveUploadUrl } from "../lib/api";
import {
  displaySentimentForItem,
  effectiveFeedbackMode,
  feedbackModeLabel,
  ticketAiSummaryForItem,
} from "../lib/feedbackDisplay";
import { BotConversationFeedbackSection } from "./BotConversationFeedbackSection";
import { VoiceAudioPlayer } from "./VoiceAudioPlayer";
import { ticketDepartment } from "../lib/ticketFilters";
import { displayOptionalLabel } from "../lib/fieldSanitize";
import { filterAiTopicsForTranscript } from "../lib/aiTopicsFilter";

const ratingLabel: Record<number, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

function audioSrc(url: string | null | undefined): string | null {
  return resolveUploadUrl(url ?? null);
}

type FeedbackDetailDialogProps = {
  item: FeedbackItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeedbackDetailDialog({ item, open, onOpenChange }: FeedbackDetailDialogProps) {
  const [fullItem, setFullItem] = useState<FeedbackItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voiceAudioVisible, setVoiceAudioVisible] = useState(true);

  useEffect(() => {
    if (!open || !item?._id) {
      setFullItem(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void getFeedbackById(item._id)
      .then((row) => {
        if (!cancelled) setFullItem(row);
      })
      .catch(() => {
        if (!cancelled) setFullItem(item);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, item]);

  const display = fullItem ?? item;

  useEffect(() => {
    setVoiceAudioVisible(true);
  }, [display?._id, display?.voiceRecordingUrl]);

  if (!open || !display) return null;

  const voiceSrc = audioSrc(display.voiceRecordingUrl);
  const botAnswers = [...(display.botConversationAnswers ?? [])].sort(
    (a, b) => a.questionOrder - b.questionOrder
  );
  const displayMode = effectiveFeedbackMode(display);
  const isBot = displayMode === "bot" && botAnswers.length > 0;
  const hasVoice = Boolean(voiceSrc);
  const transcript = display.comments?.trim() || "";
  const ticketSummary = ticketAiSummaryForItem(display);
  const transcriptFallbackSummary = transcript
    ? `${transcript.replace(/\s+/g, " ").trim().slice(0, 220)}${
        transcript.length > 220 ? "..." : ""
      }`
    : "";
  const aiSummary =
    ticketSummary ||
    (display.aiSentiment
      ? `AI sentiment: ${display.aiSentiment}. Review the full feedback below.`
      : transcriptFallbackSummary || "AI summary not generated yet.");
  const displayTopics = filterAiTopicsForTranscript(display.aiTopics, transcript);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Feedback details</DialogTitle>
          <p className="text-sm text-gray-500">
            {display.employeeName} · {new Date(display.createdAt).toLocaleString()}
          </p>
        </DialogHeader>

        {detailLoading ? (
          <p className="text-sm text-gray-500 py-4">Loading full feedback…</p>
        ) : null}

        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-700">
              {feedbackModeLabel[displayMode]}
            </span>
            <span className="px-2 py-1 rounded-md bg-gray-100 text-gray-700">
              Rating: {display.rating} · {ratingLabel[display.rating] ?? "—"}
            </span>
            {displaySentimentForItem(display) ? (
              <span
                className={`px-2 py-1 rounded-md capitalize ${
                  displaySentimentForItem(display) === "positive"
                    ? "bg-emerald-50 text-emerald-800"
                    : displaySentimentForItem(display) === "negative"
                      ? "bg-red-50 text-red-700"
                      : "bg-blue-50 text-blue-800"
                }`}
              >
                AI {displaySentimentForItem(display)}
              </span>
            ) : null}
          </div>

          <div className="text-sm">
            <p className="text-gray-500">Department</p>
            <p className="font-medium text-gray-800">
              {displayOptionalLabel(ticketDepartment(display) || display.department)}
            </p>
          </div>

          <section className="rounded-xl border-2 border-primary/30 bg-gradient-to-r from-purple-50 to-brand-50 p-4">
            <h3 className="text-sm font-bold text-primary uppercase tracking-wide mb-2">
              AI summary
            </h3>
            <p className="text-gray-800 leading-relaxed">{aiSummary}</p>
            {(display.aiUrgency || displayTopics.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {display.aiUrgency ? (
                  <span className="text-xs px-2 py-1 rounded-full bg-white border capitalize">
                    Urgency: {display.aiUrgency}
                  </span>
                ) : null}
                {displayTopics.map((t) => (
                  <span key={t} className="text-xs px-2 py-1 rounded-md bg-white/80 border text-gray-700">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </section>

          {isBot ? (
            <BotConversationFeedbackSection
              answers={botAnswers}
              combinedSessionUrl={display.voiceRecordingUrl}
              fullTranscript={display.comments}
              groupNote={display.botVoiceSourceFeedbackId ? "Voice Q&A from linked bot submission." : null}
              compact
            />
          ) : (
            <>
              <section>
                <h3 className="text-sm font-bold text-primary uppercase tracking-wide mb-2">
                  Speech-to-text
                  {displayMode === "voice" ? " (Sarvam)" : ""}
                </h3>
                <p className="text-gray-700 leading-relaxed whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4">
                  {transcript || "—"}
                </p>
              </section>
              {hasVoice && voiceAudioVisible ? (
                <section>
                  <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-2">
                    Voice audio (what employee spoke)
                  </h3>
                  <VoiceAudioPlayer
                    src={voiceSrc!}
                    onUnavailable={() => setVoiceAudioVisible(false)}
                  />
                </section>
              ) : null}
            </>
          )}

          {display.staffRemarks?.trim() ? (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-bold text-amber-900 uppercase tracking-wide mb-2">
                Staff remarks
              </h3>
              <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{display.staffRemarks.trim()}</p>
            </section>
          ) : null}

        </div>
      </DialogContent>
    </Dialog>
  );
}
