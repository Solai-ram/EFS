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
import { ChevronRight, Languages } from "lucide-react";

type InputKind = "voice" | "type";


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
  // True once the AI voice guide has started asking; the helper note above the questions is hidden then.
  const [guideStarted, setGuideStarted] = useState(false);
  // Asked first for new joiner and relieving; the questions, voice and labels follow this choice.
  const [lang, setLang] = useState<QuestionnaireLanguage | null>(null);
  const [hoverLang, setHoverLang] = useState<QuestionnaireLanguage | null>(null);

  const [comments, setComments] = useState("");
  const [remark, setRemark] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "text" | "voice">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [transcriptionPending, setTranscriptionPending] = useState(false);
  const [primaryColor, setPrimaryColor] = useState("#DC1A1F");
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
      if (!comments.trim()) {
        setSubmitError("Please write your feedback first.");
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
        : (selectedEmotion ?? 0); // 0 = typed free text: the server reads it and rates it
      const payload = {
        ...identity.getSubmitFields(),
        rating: submitRating || 3,
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
          rating: submitRating || 3,
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
          rating: submitRating || 3,
          fromStaffSession: internalSubmit,
          staffRemarks: remark.trim() || undefined,
          aiSummary: typeof created.aiSummary === "string" ? created.aiSummary : undefined,
          aiSentiment: created.aiSentiment as "positive" | "neutral" | "negative" | undefined,
          aiUrgency: created.aiUrgency as string | undefined,
          aiTopics: Array.isArray(created.aiTopics) ? (created.aiTopics as string[]) : undefined,
          voiceUploadWarning,
          offlineQueued,
          // Exit interviews unlock the relieving letter on the thank-you page.
          relievingLetter:
            feedbackType === "relieving"
              ? {
                  employeeName: identity.getSubmitFields().employeeName,
                  employeeId: identity.getSubmitFields().employeeId,
                  department: identity.getSubmitFields().department ?? "",
                  dateOfJoining: identity.getSubmitFields().dateOfJoining ?? "",
                  lastWorkingDay: identity.getSubmitFields().lastWorkingDay ?? "",
                }
              : undefined,
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
    : Boolean(comments.trim() && identity.identityReady);
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
      : Boolean(comments.trim());

  const linkClass = "inline text-left font-semibold underline decoration-1 underline-offset-2 hover:decoration-2";

  if (isQuestionnaire && !lang) {
    return (
      <div className="max-w-3xl mx-auto">
        <EmployeeCard
          kicker="AI voice guide"
          title={feedbackType === "new_joiner" ? "New joiner stay interview" : "Exit interview"}
          subtitle="Questions in English or Tamil · பதில் குரலில்"
        >
          <div className="space-y-7 py-2 md:py-6">
            <div className="text-center">
              <div
                className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full"
                style={{ backgroundColor: `${primaryColor}14`, color: primaryColor }}
              >
                <Languages size={26} />
              </div>
              <h3 className="text-xl font-semibold tracking-tight text-gray-900 md:text-2xl">Choose your language</h3>
              <p className="mt-1 text-base text-gray-500" lang="ta">
                மொழியைத் தேர்ந்தெடுக்கவும்
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" role="group" aria-label="Language">
              {(
                [
                  { id: "en", glyph: "A", label: "English", sub: "Continue in English" },
                  { id: "ta", glyph: "அ", label: "தமிழ்", sub: "தமிழில் தொடரவும்" },
                ] as const
              ).map((option) => {
                const active = hoverLang === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setLang(option.id)}
                    onMouseEnter={() => setHoverLang(option.id)}
                    onMouseLeave={() => setHoverLang(null)}
                    onFocus={() => setHoverLang(option.id)}
                    onBlur={() => setHoverLang(null)}
                    className="group flex items-center gap-4 rounded-2xl border bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:translate-y-0 md:p-6"
                    style={{
                      borderColor: active ? primaryColor : "#ECDFCC",
                      boxShadow: active ? `0 0 0 3px ${primaryColor}1F` : undefined,
                    }}
                  >
                    <span
                      className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-2xl font-bold transition-colors duration-200"
                      style={{
                        backgroundColor: active ? primaryColor : `${primaryColor}14`,
                        color: active ? "#FFFFFF" : primaryColor,
                      }}
                      aria-hidden="true"
                      lang={option.id}
                    >
                      {option.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold leading-tight text-gray-900" lang={option.id}>
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-sm text-gray-500" lang={option.id}>
                        {option.sub}
                      </span>
                    </span>
                    <ChevronRight
                      size={20}
                      className="shrink-0 text-gray-300 transition-all duration-200 group-hover:translate-x-0.5"
                      style={{ color: active ? primaryColor : undefined }}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>

            <p className="mx-auto max-w-md text-center text-sm leading-relaxed text-gray-500">
              The questions, the AI voice guide and your spoken answers will use this language. You can change it
              later.
              <span className="mt-1 block" lang="ta">
                கேள்விகள், குரல் வழிகாட்டி மற்றும் உங்கள் பதில்கள் இந்த மொழியிலேயே இருக்கும்.
              </span>
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
                ? "Speak freely"
                : "Type freely"
        }
        title={
          feedbackType === "new_joiner"
            ? "How is your first month going?"
            : feedbackType === "relieving"
              ? "Before you go, tell us about your time here"
              : "What would you like to tell us?"
        }
        subtitle={
          feedbackType === "new_joiner"
            ? "A quick check-in so we can fix problems early. Your answers go to HR."
            : feedbackType === "relieving"
              ? "Your honest views help us improve employment practices. Finish the interview to view your relieving letter."
              : inputKind === "voice"
                ? "Say it in your own words — Tamil, Hindi or English."
                : "Write it in your own words, in any language. Your feedback reaches the team that can act on it."
        }
      >
        {isQuestionnaire && guideStarted ? null : (
        <section className="mb-8">
          <StepHeading step={1} title="Your details" primaryColor={primaryColor} />
          <EmployeeIdentitySection identity={identity} primaryColor={primaryColor} />
          {isQuestionnaire && guideStarted ? null : (
            <StatusNote
              primaryColor={primaryColor}
              ready={inputKind === "voice" && identity.identityReady}
            >
              {isQuestionnaire ? (
                <>
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
                  <>Ready to listen{identity.resolvedEmployeeName ? `, ${identity.resolvedEmployeeName}` : ""}. Tap below to share your experience.</>
                ) : (
                  "Please choose your department before speaking."
                )
              ) : (
                <>
                  Prefer to speak?{" "}
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
          )}
        </section>
        )}

        {isQuestionnaire && (
          <section className="mb-8">
            {guideStarted ? null : (
            <StepHeading
              step={2}
              title={feedbackType === "new_joiner" ? "Your first weeks" : "Your exit interview"}
              hint={
                lang === "ta"
                  ? useGuide
                    ? "AI குரல் வழிகாட்டி ஒவ்வொரு கேள்வியையும் கேட்கும். பேசி பதில் சொல்லுங்கள்."
                    : "* குறியிட்ட கேள்விகளுக்கு பதில் அவசியம்."
                  : useGuide
                    ? "The AI Voice Guide asks each question aloud. Speak your answer."
                    : "Fields marked * are required."
              }
              primaryColor={primaryColor}
            />
            )}
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
                onStartedChange={setGuideStarted}
                letter={
                  feedbackType === "relieving"
                    ? {
                        employeeName: identity.employeeName,
                        employeeId: identity.employeeId,
                        department: identity.department,
                        dateOfJoining: identity.dateOfJoining,
                        lastWorkingDay: identity.lastWorkingDay,
                      }
                    : undefined
                }
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
              title="Your feedback"
              hint="Write anything you want us to know: what is working, what is not, or an idea."
              primaryColor={primaryColor}
            />
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Type your feedback here…"
              maxLength={4000}
              className="h-44 w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none transition placeholder:text-gray-400 md:h-52"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = primaryColor;
                e.currentTarget.style.boxShadow = `0 0 0 4px ${primaryColor}1A`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
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
