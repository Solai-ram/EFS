import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  enqueueFeedbackSubmission,
  newOutboxId,
  notifyOutboxChanged,
  saveVoiceDraft,
  syncAfterEnqueue,
} from "../lib/feedbackOutbox";
import { getSession, isInternalUser } from "../lib/auth";
import { useEmployeeIdentity } from "../lib/useEmployeeIdentity";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
} from "../lib/branding";
import { FeedbackRemarkField } from "./StaffRemarksField";
import { FeedbackVoiceSection } from "./FeedbackVoiceSection";
import { EmployeeIdentitySection } from "./EmployeeIdentitySection";
import { QuestionnaireFields } from "./QuestionnaireFields";
import { QuestionnaireVoiceGuide } from "./QuestionnaireVoiceGuide";
import { parseFeedbackType } from "../lib/feedbackTypes";
import { QUESTIONNAIRE_TEXT, type QuestionnaireLanguage } from "../lib/questionnaireLanguage";
import {
  estimateRating,
  firstMissingQuestion,
  toPayloadAnswers,
  useQuestionnaire,
  type AnswerMap,
} from "../lib/useQuestionnaire";
import { EmployeeCard, EmployeeFooter, PrimaryAction, StatusNote, StepHeading } from "./EmployeeCard";
import { CheckCircle2, Languages } from "lucide-react";
import rating5 from "./image/rating/rating-5.png";
import rating4 from "./image/rating/rating-4.png";
import rating3 from "./image/rating/rating-3.png";
import rating2 from "./image/rating/rating-2.png";
import rating1 from "./image/rating/rating-1.png";

type InputKind = "voice" | "type";

const emotions = [
  { id: 5, image: rating5, label: "Excellent", prompt: "What do you like most about working here?" },
  { id: 4, image: rating4, label: "Good", prompt: "What is going well?" },
  { id: 3, image: rating3, label: "Okay", prompt: "How can we improve?" },
  { id: 2, image: rating2, label: "Poor", prompt: "What went wrong?" },
  { id: 1, image: rating1, label: "Very Poor", prompt: "What went wrong?" },
];

export function FeedbackForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const modeParam = searchParams.get("mode");
  const feedbackType = parseFeedbackType(searchParams.get("type"));
  // New joiner and relieving feedback are questionnaires: always typed, never voice.
  const isQuestionnaire = feedbackType !== "general";
  const inputKind: InputKind = !isQuestionnaire && modeParam === "voice" ? "voice" : "type";

  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceRecordingBlob, setVoiceRecordingBlob] = useState<Blob | null>(null);
  const [voiceRevision, setVoiceRevision] = useState(0);
  const [selectedEmotion, setSelectedEmotion] = useState<number | null>(null);
  const identity = useEmployeeIdentity(feedbackType);
  const { questions, loading: questionsLoading, error: questionsError } = useQuestionnaire(feedbackType);
  const [answers, setAnswers] = useState<AnswerMap>({});
  // New joiner and relieving open with the AI Voice Guide; employees can switch to typing.
  const [useGuide, setUseGuide] = useState(true);
  // True once the guide has asked every question; until then Remark and Submit stay hidden.
  const [guideDone, setGuideDone] = useState(false);
  // Asked first for new joiner and relieving; the questions, voice and labels follow this choice.
  const [lang, setLang] = useState<QuestionnaireLanguage | null>(null);
  const [hoverLang, setHoverLang] = useState<QuestionnaireLanguage | null>(null);

  const [comments, setComments] = useState("");
  const [remark, setRemark] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "text" | "voice">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [transcriptionPending, setTranscriptionPending] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#8B1538");
  const prevModeBucketRef = useRef<string | null>(null);
  const outboxIdRef = useRef<string | null>(null);
  const draftCommentsRef = useRef("");
  const draftRatingRef = useRef<number | null>(null);
  const voiceBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    const bucket = modeParam === "voice" ? "voice" : "type";
    if (prevModeBucketRef.current === null) {
      prevModeBucketRef.current = bucket;
      return;
    }
    if (prevModeBucketRef.current === bucket) return;
    prevModeBucketRef.current = bucket;
    setSubmitError(null);
    setRemark("");
    setSelectedEmotion(null);
    setComments("");
    setAnswers({});
    setVoiceReady(false);
    setVoiceRecordingBlob(null);
    setVoiceRevision((r) => r + 1);
    setTranscriptionPending(false);
    outboxIdRef.current = null;
    identity.reset();
  }, [modeParam, identity.reset]);

  const internalSubmit = isInternalUser(getSession());

  const selectedEmotionData = emotions.find((e) => e.id === selectedEmotion);

  useEffect(() => {
    void loadBrandingSettings().then((current) => {
      setPrimaryColor(current.primaryColor);
    });
    return onBrandingSettingsChange(() => {
      setPrimaryColor(getBrandingSettings().primaryColor);
    });
  }, []);

  const getSubmitFields = identity.getSubmitFields;

  const persistVoiceDraft = useCallback(
    async (transcript: string, inferredRating: number, audioBlob: Blob | null) => {
      if (!outboxIdRef.current) outboxIdRef.current = newOutboxId();
      const isStaffSession = getSession()?.role === "staff";
      await saveVoiceDraft(
        outboxIdRef.current,
        {
          ...getSubmitFields(),
          rating: inferredRating,
          comments: transcript.trim(),
          source: isStaffSession ? "staff" : "employee",
          submissionMode: "voice",
        },
        audioBlob
      );
    },
    [getSubmitFields]
  );

  const onVoiceSuccess = useCallback(
    (transcript: string, inferredRating: number) => {
      draftCommentsRef.current = transcript;
      draftRatingRef.current = inferredRating;
      setComments(transcript);
      setSelectedEmotion(inferredRating);
      setVoiceReady(true);
      setSubmitError(null);
      void persistVoiceDraft(transcript, inferredRating, voiceBlobRef.current);
    },
    [persistVoiceDraft]
  );

  const onVoiceCleared = useCallback(() => {
    setVoiceReady(false);
    setSelectedEmotion(null);
    setComments("");
  }, []);

  const onVoiceError = useCallback((message: string | null) => {
    setSubmitError(message);
  }, []);

  const onVoiceRecordingReady = useCallback(
    (blob: Blob | null) => {
      voiceBlobRef.current = blob;
      setVoiceRecordingBlob(blob);
      if (!blob) return;
      // Save the raw recording to IndexedDB the instant it's available — before
      // transcription finishes — so a dropped connection during transcription
      // never loses the audio. onVoiceSuccess overwrites this same draft (same
      // outbox id) with the final transcript/rating once ready.
      const transcript = draftCommentsRef.current.trim();
      const rating = draftRatingRef.current ?? 3;
      void persistVoiceDraft(transcript, rating, blob);
    },
    [persistVoiceDraft]
  );

  const handleSubmit = async () => {
    const identityError = identity.validateForSubmit();
    if (identityError) {
      setSubmitError(identityError);
      return;
    }

    if (isQuestionnaire) {
      const missing = firstMissingQuestion(questions, answers);
      if (!questions.length) {
        setSubmitError(questionsError || "The questions are still loading. Please try again.");
        return;
      }
      if (missing) {
        setSubmitError(`Please answer: ${missing.textEn}`);
        return;
      }
    } else if (inputKind === "type") {
      if (!selectedEmotion) {
        setSubmitError("Please choose how your experience felt.");
        return;
      }
    } else {
      if (!voiceReady || selectedEmotion == null) {
        setSubmitError("Please speak your feedback first.");
        return;
      }
      if (transcriptionPending) {
        setSubmitError(
          "Still finishing transcription — your recording is saved and this will complete automatically in a moment."
        );
        return;
      }
      const c = comments.trim();
      if (!c || c === "(No speech detected.)") {
        setSubmitError("No speech detected — tap to speak again.");
        return;
      }
    }

    try {
      setSubmitError(null);
      setIsSubmitting(true);
      setSubmitPhase("text");
      const outboxId = outboxIdRef.current ?? newOutboxId();
      outboxIdRef.current = outboxId;

      // For questionnaires the server derives the stored rating from the answers.
      const submitRating = isQuestionnaire
        ? estimateRating(questions, answers)
        : (selectedEmotion as number);
      const payload = {
        ...identity.getSubmitFields(),
        rating: submitRating,
        comments: isQuestionnaire ? "" : comments.trim(),
        ...(isQuestionnaire ? { answers: toPayloadAnswers(questions, answers) } : {}),
        ...(remark.trim() ? { staffRemarks: remark.trim() } : {}),
        source: (internalSubmit ? "staff" : "employee") as "staff" | "employee",
        submissionMode: (inputKind === "voice" ? "voice" : "standard") as "voice" | "standard",
      };

      await enqueueFeedbackSubmission({
        id: outboxId,
        payload,
        audioBlob: inputKind === "voice" ? voiceBlobRef.current ?? voiceRecordingBlob : null,
        thankYouState: {
          rating: submitRating,
          fromStaffSession: internalSubmit,
        },
      });

      if (inputKind === "voice" && voiceRecordingBlob?.size) {
        setSubmitPhase("voice");
      }

      const syncResult = await syncAfterEnqueue(outboxId);
      notifyOutboxChanged();

      let voiceUploadWarning: string | undefined;
      let offlineQueued = false;
      let created: Record<string, unknown> = {};

      if (syncResult.kind === "queued") {
        offlineQueued = true;
      } else {
        created = syncResult.response;
        if (syncResult.kind === "text_only") {
          voiceUploadWarning =
            "Your feedback was saved. We could not finish sending everything — your words are on record.";
        }
      }

      navigate("/thank-you", {
        state: {
          rating: submitRating,
          fromStaffSession: internalSubmit,
          staffRemarks: remark.trim() || undefined,
          aiSummary: typeof created.aiSummary === "string" ? created.aiSummary : undefined,
          aiSentiment: created.aiSentiment as "positive" | "neutral" | "negative" | undefined,
          aiUrgency: created.aiUrgency as string | undefined,
          aiTopics: Array.isArray(created.aiTopics) ? (created.aiTopics as string[]) : undefined,
          voiceUploadWarning,
          offlineQueued,
        },
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
      setSubmitPhase("idle");
    }
  };

  const canSubmitType = isQuestionnaire
    ? questions.length > 0 && !firstMissingQuestion(questions, answers) && identity.identityReady
    : Boolean(selectedEmotion && identity.identityReady);
  const canSubmitVoice = Boolean(
    voiceReady && selectedEmotion != null && identity.identityReady && !transcriptionPending
  );

  const submitEnabled =
    identity.identityReady &&
    !isSubmitting &&
    (inputKind === "type" ? canSubmitType : canSubmitVoice);

  const guideActive = isQuestionnaire && useGuide && !guideDone;
  const showRemark = isQuestionnaire
    ? questions.length > 0 && !guideActive
    : inputKind === "voice"
      ? voiceReady
      : Boolean(selectedEmotion);

  const linkClass = "inline text-left font-semibold underline decoration-1 underline-offset-2 hover:decoration-2";

  if (isQuestionnaire && !lang) {
    return (
      <div className="max-w-3xl mx-auto">
        <EmployeeCard
          kicker="AI voice guide"
          title={feedbackType === "new_joiner" ? "New joiner stay interview" : "Exit interview"}
          subtitle="Questions in English or Tamil · பதில் குரலில்"
        >
          <div className="space-y-8 py-4 text-center md:py-8">
            <div
              className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-white"
              style={{ backgroundColor: primaryColor }}
            >
              <Languages size={20} />
              <span>Choose your language · மொழியைத் தேர்ந்தெடுக்கவும்</span>
            </div>

            <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              {(
                [
                  { id: "en", label: "English", sub: "Continue in English" },
                  { id: "ta", label: "தமிழ்", sub: "தமிழில் தொடரவும்" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLang(option.id)}
                  className="flex min-w-[14rem] flex-col items-center rounded-full border-2 px-10 py-4 transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-0"
                  style={{
                    borderColor: primaryColor,
                    backgroundColor: hoverLang === option.id ? primaryColor : "#FFFFFF",
                    color: hoverLang === option.id ? "#FFFFFF" : primaryColor,
                  }}
                  onMouseEnter={() => setHoverLang(option.id)}
                  onMouseLeave={() => setHoverLang(null)}
                  onFocus={() => setHoverLang(option.id)}
                  onBlur={() => setHoverLang(null)}
                >
                  <span className="text-xl font-bold leading-tight" lang={option.id}>
                    {option.label}
                  </span>
                  <span className="mt-0.5 text-sm opacity-80" lang={option.id}>
                    {option.sub}
                  </span>
                </button>
              ))}
            </div>

            <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-500">
              The questions, the AI voice guide and your spoken answers will use this language. You can change it
              later.
            </p>
          </div>
        </EmployeeCard>
        <EmployeeFooter onBack={() => navigate("/feedback")} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <EmployeeCard
        kicker={
          feedbackType === "new_joiner"
            ? "New joiner · 15-day stay interview"
            : feedbackType === "relieving"
              ? "Relieving · Exit interview"
              : inputKind === "voice"
                ? "Voice feedback"
                : "Rate & share"
        }
        title={
          feedbackType === "new_joiner"
            ? "How is your first month going?"
            : feedbackType === "relieving"
              ? "Before you go, tell us about your time here"
              : "How is your experience working here?"
        }
        subtitle={
          feedbackType === "new_joiner"
            ? "A quick check-in so we can fix problems early. Your answers go to HR."
            : feedbackType === "relieving"
              ? "Your honest views help us improve employment practices. Thank you for your contribution."
              : inputKind === "voice"
                ? "Tell us about your experience in your own words — Tamil, Hindi or English."
                : "Your feedback reaches the team that can act on it."
        }
      >
        <section className="mb-8">
          <StepHeading step={1} title="Your details" primaryColor={primaryColor} />
          <EmployeeIdentitySection identity={identity} primaryColor={primaryColor} />
          <StatusNote
            primaryColor={primaryColor}
            ready={inputKind === "voice" && identity.identityReady}
          >
            {isQuestionnaire ? (
              <>
                HR staff can fill this form on behalf of an employee who needs help.{" "}
                <button
                  type="button"
                  onClick={() => setLang(null)}
                  className={linkClass}
                  style={{ color: primaryColor }}
                >
                  Change language · மொழியை மாற்று
                </button>
                . Prefer a different kind of feedback?{" "}
                <button
                  type="button"
                  onClick={() => navigate("/feedback")}
                  className={linkClass}
                  style={{ color: primaryColor }}
                >
                  Go back
                </button>
              </>
            ) : inputKind === "voice" ? (
              identity.identityReady ? (
                <>Ready to listen, {identity.resolvedEmployeeName}. Tap below to share your experience.</>
              ) : (
                "Please fill in your name, employee ID and department before speaking."
              )
            ) : (
              <>
                HR staff can fill this form on behalf of an employee who needs help. Prefer to speak?{" "}
                <button
                  type="button"
                  onClick={() => navigate("/feedback/give?mode=voice&type=general", { replace: true })}
                  className={linkClass}
                  style={{ color: primaryColor }}
                >
                  Use voice instead
                </button>{" "}
                (Tamil, Hindi &amp; English). Or{" "}
                <button
                  type="button"
                  onClick={() => navigate("/feedback")}
                  className={linkClass}
                  style={{ color: primaryColor }}
                >
                  pick again on the previous screen
                </button>
              </>
            )}
          </StatusNote>
        </section>

        {isQuestionnaire && (
          <section className="mb-8">
            <StepHeading
              step={2}
              title={feedbackType === "new_joiner" ? "Your first weeks" : "Your exit interview"}
              hint={
                lang === "ta"
                  ? useGuide
                    ? "AI குரல் வழிகாட்டி ஒவ்வொரு கேள்வியையும் கேட்கும். பேசி அல்லது தொட்டு பதில் சொல்லுங்கள்."
                    : "* குறியிட்ட கேள்விகளுக்கு பதில் அவசியம்."
                  : useGuide
                    ? "The AI Voice Guide asks each question aloud. Speak or tap your answer."
                    : "Fields marked * are required."
              }
              primaryColor={primaryColor}
            />
            {questionsLoading && !questions.length ? (
              <p className="text-sm text-gray-500">Loading questions…</p>
            ) : questionsError && !questions.length ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
                {questionsError}. Check your connection and reload this page.
              </p>
            ) : useGuide ? (
              <QuestionnaireVoiceGuide
                feedbackType={feedbackType as "new_joiner" | "relieving"}
                questions={questions}
                answers={answers}
                onChange={setAnswers}
                primaryColor={primaryColor}
                lang={lang ?? "en"}
                onSwitchToTyping={() => setUseGuide(false)}
                onFinishedChange={setGuideDone}
                canStart={identity.validateForSubmit() === null}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setGuideDone(false);
                    setUseGuide(true);
                  }}
                  className="mb-4 text-sm font-medium underline"
                  style={{ color: primaryColor }}
                >
                  {QUESTIONNAIRE_TEXT[lang ?? "en"].useGuide}
                </button>
                <QuestionnaireFields
                  questions={questions}
                  answers={answers}
                  onChange={setAnswers}
                  primaryColor={primaryColor}
                  lang={lang ?? "en"}
                />
              </>
            )}
          </section>
        )}

        {inputKind === "voice" && (
          <section className="mb-6">
            <StepHeading
              step={2}
              title="Share your experience"
              hint="Choose a language if you like, then tap the microphone and speak naturally."
              primaryColor={primaryColor}
            />
            <FeedbackVoiceSection
              identityReady={identity.identityReady}
              primaryColor={primaryColor}
              resetRevision={voiceRevision}
              onVoiceSuccess={onVoiceSuccess}
              onVoiceCleared={onVoiceCleared}
              onVoiceError={onVoiceError}
              onVoiceRecordingReady={onVoiceRecordingReady}
              onTranscriptionPendingChange={setTranscriptionPending}
            />
          </section>
        )}

        {inputKind === "type" && !isQuestionnaire && (
          <section className="mb-8">
            <StepHeading
              step={2}
              title="Rate your experience"
              hint={
                <>
                  Choose how you felt, then{" "}
                  <span className="font-medium text-gray-700">
                    describe your experience in comments so your rating matches your words.
                  </span>
                </>
              }
              primaryColor={primaryColor}
            />
            <div className="grid grid-cols-5 gap-2 md:gap-3" role="radiogroup" aria-label="Rating">
              {emotions.map((emotion) => {
                const selected = selectedEmotion === emotion.id;
                const dimmed = selectedEmotion != null && !selected;
                return (
                  <button
                    key={emotion.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedEmotion(emotion.id)}
                    className="group relative flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl border bg-white px-1 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md md:min-h-[128px] md:py-5"
                    style={
                      selected
                        ? {
                            borderColor: primaryColor,
                            backgroundColor: `${primaryColor}0A`,
                            boxShadow: `0 0 0 3px ${primaryColor}1F`,
                          }
                        : { borderColor: "#E8E1D9" }
                    }
                  >
                    {selected ? (
                      <CheckCircle2
                        className="absolute right-1.5 top-1.5 h-4 w-4 md:right-2 md:top-2"
                        style={{ color: primaryColor }}
                      />
                    ) : null}
                    <img
                      src={emotion.image}
                      alt=""
                      draggable={false}
                      className={`h-11 w-11 select-none transition-all duration-200 md:h-14 md:w-14 ${
                        selected
                          ? "scale-110 drop-shadow-[0_6px_10px_rgb(0_0_0/0.15)]"
                          : dimmed
                            ? "opacity-45 grayscale group-hover:opacity-80 group-hover:grayscale-0"
                            : "group-hover:scale-105"
                      }`}
                    />
                    <span
                      className={`text-center text-[11px] leading-tight md:text-sm ${
                        selected ? "font-semibold" : "font-medium text-gray-600"
                      }`}
                      style={selected ? { color: primaryColor } : undefined}
                    >
                      {emotion.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedEmotionData && (
              <div className="mt-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="mb-2 block text-sm font-semibold text-gray-800 md:text-base">
                  {selectedEmotionData.prompt}
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Share your thoughts... (optional)"
                  className="h-32 w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition placeholder:text-gray-400 md:h-36"
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = primaryColor;
                    e.currentTarget.style.boxShadow = `0 0 0 4px ${primaryColor}1A`;
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
            )}
          </section>
        )}

        {showRemark ? (
          <div className="mb-6">
            <FeedbackRemarkField value={remark} onChange={setRemark} />
          </div>
        ) : null}

        {guideActive ? null : (
        <PrimaryAction
          primaryColor={primaryColor}
          onClick={() => void handleSubmit()}
          disabled={!submitEnabled}
        >
          {isSubmitting ? (
            <>
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              {submitPhase === "voice" ? "Almost done..." : "Submitting..."}
            </>
          ) : (
            "Submit feedback"
          )}
        </PrimaryAction>
        )}
        {submitError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-700">
            {submitError}
          </p>
        )}
      </EmployeeCard>

      <EmployeeFooter
        timing={isQuestionnaire ? "Takes about 5 minutes" : "Takes less than a minute"}
        onBack={() => navigate("/feedback")}
      />
    </div>
  );
}
