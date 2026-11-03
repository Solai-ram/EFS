import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Loader, Mic, Volume2 } from "lucide-react";
import {
  coerceTranscriptText,
  createBotFeedback,
  getBotConversationConfig,
  resolveUploadUrl,
  type BotConversationAnswer,
  type BotConversationConfig,
  type BotConversationQuestion,
} from "../lib/api";
import { transcribeVoiceRecordingChunked } from "../lib/audioTranscription";
import { getSession, isInternalUser } from "../lib/auth";
import { useEmployeeIdentity } from "../lib/useEmployeeIdentity";
import { EmployeeIdentitySection } from "./EmployeeIdentitySection";
import { EmployeeFooter, PrimaryAction, StatusNote, StepHeading } from "./EmployeeCard";
import { FeedbackRemarkField } from "./StaffRemarksField";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
} from "../lib/branding";
import { HOSPITAL } from "../lib/hospital";

const DEFAULT_BOT_THINK_SECONDS = 3;
const MAX_RECORD_MS = 45000;
const SILENCE_MS = 2200;
const MIN_RECORD_MS = 900;
const SILENCE_RMS_THRESHOLD = 7;

type Phase = "loading" | "identity" | "intro" | "question" | "complete" | "submitting";
type QuestionPhase = "prompt" | "think" | "record" | "processing";

function questionAudioUrl(q: BotConversationQuestion | null): string | null {
  if (!q) return null;
  return resolveUploadUrl(q.audioUrl || q.videoUrl);
}

async function playAudioFile(el: HTMLAudioElement, src: string): Promise<void> {
  el.pause();
  el.currentTime = 0;
  el.src = src;
  el.load();
  await el.play();
}

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function BotConversationFeedback() {
  const navigate = useNavigate();
  const [primaryColor, setPrimaryColor] = useState("#8B1538");
  const [config, setConfig] = useState<BotConversationConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const identity = useEmployeeIdentity();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [questionPhase, setQuestionPhase] = useState<QuestionPhase>("prompt");
  const [thinkSeconds, setThinkSeconds] = useState(DEFAULT_BOT_THINK_SECONDS);
  const [skipIntro, setSkipIntro] = useState(false);
  const [skipThinkCountdown, setSkipThinkCountdown] = useState(false);
  const [thinkCountdown, setThinkCountdown] = useState(DEFAULT_BOT_THINK_SECONDS);
  const [answers, setAnswers] = useState<BotConversationAnswer[]>([]);
  const [answerBlobs, setAnswerBlobs] = useState<Blob[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [isPlayingPrompt, setIsPlayingPrompt] = useState(false);

  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const questionAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef(0);
  const thinkTimerRef = useRef(0);
  const silenceIntervalRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const finishingRef = useRef(false);
  const beginThinkCountdownRef = useRef<() => void>(() => {});

  const sortedQuestions: BotConversationQuestion[] = config
    ? [...config.questions].sort((a, b) => a.order - b.order)
    : [];
  const currentQuestion = sortedQuestions[questionIndex] ?? null;
  const introAudioSrc = resolveUploadUrl(config?.introAudioUrl || config?.introVideoUrl);

  useEffect(() => {
    void loadBrandingSettings().then((c) => {
      setPrimaryColor(c.primaryColor);
      setThinkSeconds(c.botThinkSeconds);
      setSkipIntro(c.botSkipIntro);
      setSkipThinkCountdown(c.botSkipThinkCountdown);
    });
    return onBrandingSettingsChange(() => {
      const b = getBrandingSettings();
      setPrimaryColor(b.primaryColor);
      setThinkSeconds(b.botThinkSeconds);
      setSkipIntro(b.botSkipIntro);
      setSkipThinkCountdown(b.botSkipThinkCountdown);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    void getBotConversationConfig()
      .then((cfg) => {
        if (!alive) return;
        setConfig(cfg);
        setPhase("identity");
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "Could not load questions");
        setPhase("identity");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (phase !== "identity" || !identity.identityReady) return;
    setSubmitError((prev) => {
      if (!prev) return prev;
      if (
        prev.startsWith("Please enter") ||
        prev.startsWith("Please select") ||
        prev.startsWith("Date of joining")
      ) {
        return null;
      }
      return prev;
    });
  }, [phase, identity.identityReady]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (recordTimerRef.current) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = 0;
    }
    if (thinkTimerRef.current) {
      window.clearInterval(thinkTimerRef.current);
      thinkTimerRef.current = 0;
    }
    if (silenceIntervalRef.current) {
      window.clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = 0;
    }
  }, []);

  const stopSilenceMonitor = useCallback(() => {
    if (silenceIntervalRef.current) {
      window.clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = 0;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      stopSilenceMonitor();
      stopTracks();
      introAudioRef.current?.pause();
      questionAudioRef.current?.pause();
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, [clearTimers, stopSilenceMonitor, stopTracks]);

  const playQuestionAtIndex = useCallback(
    async (index: number) => {
      const q = sortedQuestions[index];
      const el = questionAudioRef.current;
      const src = questionAudioUrl(q);
      if (!el || !src) return false;
      setIsPlayingPrompt(true);
      setSubmitError(null);
      try {
        await playAudioFile(el, src);
        return true;
      } catch {
        setIsPlayingPrompt(false);
        return false;
      }
    },
    [sortedQuestions]
  );

  const playIntroAudio = useCallback(async () => {
    const el = introAudioRef.current;
    const src = introAudioSrc;
    if (!el || !src) return false;
    setIsPlayingPrompt(true);
    setSubmitError(null);
    try {
      await playAudioFile(el, src);
      return true;
    } catch {
      setIsPlayingPrompt(false);
      return false;
    }
  }, [introAudioSrc]);

  const submitAll = useCallback(async () => {
    const session = getSession();
    const internalSubmit = isInternalUser(session);
    const mergedComments = answers
      .map((a) => `Q: ${a.questionText}\nA: ${a.transcript}`)
      .join("\n\n");

    setPhase("submitting");
    setSubmitError(null);
    try {
      const created = await createBotFeedback({
        ...identity.getSubmitFields(),
        rating: 3,
        comments: mergedComments,
        ...(remark.trim() ? { staffRemarks: remark.trim() } : {}),
        source: internalSubmit ? "staff" : "employee",
        submissionMode: "bot",
        conversationAnswers: answers,
        answerAudioBlobs: answerBlobs,
      });
      navigate("/thank-you", {
        state: {
          fromStaffSession: internalSubmit,
          staffRemarks: remark.trim() || undefined,
          aiSummary: created.aiSummary || undefined,
          aiSentiment: created.aiSentiment || undefined,
          aiTopics: created.aiTopics || undefined,
        },
      });
    } catch (e) {
      setPhase("complete");
      setSubmitError(e instanceof Error ? e.message : "Could not submit feedback");
    }
  }, [answerBlobs, answers, identity, navigate, remark]);

  const finishRecording = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearTimers();
    stopSilenceMonitor();

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      finishingRef.current = false;
      stopTracks();
      return;
    }
    const q = currentQuestion;
    if (!q) {
      finishingRef.current = false;
      return;
    }

    setQuestionPhase("processing");
    setStatusHint("பதிலைப் புரிந்து கொள்கிறோம்…");

    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const b = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        resolve(b.size > 0 ? b : null);
      };
      try {
        recorder.stop();
      } catch {
        resolve(null);
      }
    });
    stopTracks();
    recorderRef.current = null;
    chunksRef.current = [];
    finishingRef.current = false;

    if (!blob) {
      setSubmitError("No voice captured. Speak again after the countdown.");
      setQuestionPhase("think");
      setThinkCountdown(thinkSeconds);
      return;
    }

    try {
      const ext = blob.type.includes("mp4") ? "m4a" : "webm";
      const { transcript: raw } = await transcribeVoiceRecordingChunked(blob, `answer.${ext}`, "ta-IN");
      const transcript = coerceTranscriptText(raw).trim() || "(No speech detected.)";
      const row: BotConversationAnswer = {
        questionOrder: q.order,
        questionText: q.textTa,
        transcript,
      };

      const isLast = questionIndex + 1 >= sortedQuestions.length;
      setAnswers((prev) => {
        const nextAnswers = [...prev, row];
        setAnswerBlobs((prevBlobs) => {
          const nextBlobs = [...prevBlobs, blob];
          if (isLast) {
            setPhase("complete");
          }
          return nextBlobs;
        });
        return nextAnswers;
      });

      if (!isLast) {
        const nextIndex = questionIndex + 1;
        setQuestionIndex(nextIndex);
        setQuestionPhase("prompt");
        setSubmitError(null);
        setStatusHint(null);
        window.setTimeout(() => {
          void playQuestionAtIndex(nextIndex).then((ok) => {
            if (!ok) beginThinkCountdownRef.current();
          });
        }, 50);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not transcribe answer");
      setQuestionPhase("record");
    }
  }, [
    clearTimers,
    currentQuestion,
    questionIndex,
    sortedQuestions.length,
    stopSilenceMonitor,
    stopTracks,
    playQuestionAtIndex,
    thinkSeconds,
  ]);

  const startSilenceMonitor = useCallback(
    (stream: MediaStream, onSilence: () => void) => {
      stopSilenceMonitor();
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const recordStart = Date.now();
      let speechStarted = false;
      let silenceStart = 0;

      silenceIntervalRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length) * 100;
        const loud = rms > SILENCE_RMS_THRESHOLD;
        if (loud) {
          speechStarted = true;
          silenceStart = 0;
        } else if (speechStarted && Date.now() - recordStart > MIN_RECORD_MS) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart >= SILENCE_MS) {
            stopSilenceMonitor();
            onSilence();
          }
        }
      }, 180);
    },
    [stopSilenceMonitor]
  );

  const startRecording = useCallback(async () => {
    setStatusHint("பதில் சொல்லுங்கள்… நிறுத்தினால் அடுத்த கேள்விக்குச் செல்வோம்");
    setSubmitError(null);
    stopTracks();
    stopSilenceMonitor();
    chunksRef.current = [];
    finishingRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSubmitError("Microphone access was denied. Allow the mic and try again.");
      setQuestionPhase("think");
      return;
    }
    streamRef.current = stream;
    const mime = pickRecorderMime();
    try {
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      setQuestionPhase("record");

      startSilenceMonitor(stream, () => {
        void finishRecording();
      });

      recordTimerRef.current = window.setTimeout(() => {
        void finishRecording();
      }, MAX_RECORD_MS);
    } catch {
      stopTracks();
      setSubmitError("This browser cannot capture voice.");
      setQuestionPhase("think");
    }
  }, [finishRecording, startSilenceMonitor, stopSilenceMonitor, stopTracks]);

  const beginThinkCountdown = useCallback(() => {
    if (skipThinkCountdown) {
      clearTimers();
      void startRecording();
      return;
    }
    const secs = Math.min(30, Math.max(1, thinkSeconds));
    setQuestionPhase("think");
    setThinkCountdown(secs);
    let left = secs;
    thinkTimerRef.current = window.setInterval(() => {
      left -= 1;
      setThinkCountdown(left);
      if (left <= 0) {
        clearTimers();
        void startRecording();
      }
    }, 1000);
  }, [clearTimers, startRecording, thinkSeconds, skipThinkCountdown]);

  beginThinkCountdownRef.current = beginThinkCountdown;

  const onPromptEnded = useCallback(() => {
    setIsPlayingPrompt(false);
    beginThinkCountdown();
  }, [beginThinkCountdown]);

  const goToFirstQuestion = useCallback(() => {
    setQuestionIndex(0);
    setPhase("question");
    setQuestionPhase("prompt");
    setSubmitError(null);
    window.setTimeout(() => {
      void playQuestionAtIndex(0).then((ok) => {
        if (!ok) beginThinkCountdown();
      });
    }, 50);
  }, [playQuestionAtIndex, beginThinkCountdown]);

  const handleStartConversation = useCallback(() => {
    const identityError = identity.validateForSubmit();
    if (identityError) {
      setSubmitError(identityError);
      return;
    }
    if (!sortedQuestions.length) return;
    setSubmitError(null);
    if (skipIntro) {
      goToFirstQuestion();
      return;
    }
    setPhase("intro");
    setSubmitError(null);
    void playIntroAudio().then((ok) => {
      if (!ok) goToFirstQuestion();
    });
  }, [identity, sortedQuestions.length, skipIntro, playIntroAudio, goToFirstQuestion]);

  if (phase === "loading") {
    return (
      <div className="max-w-3xl mx-auto p-8 flex items-center justify-center gap-3 text-gray-600">
        <Loader className="animate-spin" size={24} />
        Loading conversation…
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <audio ref={introAudioRef} className="hidden" onEnded={goToFirstQuestion} />
      <audio ref={questionAudioRef} className="hidden" onEnded={onPromptEnded} />

      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(74_13_31/0.04),0_12px_32px_-12px_rgb(74_13_31/0.12)]">
        <div className="border-b border-gray-100 px-6 pb-5 pt-6 md:px-10 md:pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A6A10]">AI voice guide</p>
          <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-gray-900 md:text-[1.75rem]">
            Voice conversation feedback
          </h2>
          <p className="mt-1.5 text-sm text-gray-500 md:text-[15px]">தமிழில் கேள்விகள் · பதில் குரலில்</p>
        </div>

        {loadError ? (
          <p className="mx-6 mt-4 text-amber-800 text-sm bg-amber-50 border border-amber-200 rounded-lg p-3">
            {loadError}
          </p>
        ) : null}

        {phase === "identity" && (
          <div className="px-6 py-6 md:px-10 md:py-8">
            <p
              className="mb-8 rounded-xl border border-gray-200 border-l-[3px] bg-gray-50 px-5 py-4 text-[15px] leading-relaxed text-gray-700 md:text-base"
              style={{ borderLeftColor: "var(--brand-gold)" }}
            >
              {config?.introText ||
                `வணக்கம்! ${HOSPITAL.nameTaLocative} உங்கள் பணி அனுபவத்தைப் பற்றி சில கேள்விகள் கேட்கிறோம்.`}
            </p>

            <StepHeading step={1} title="Your details" primaryColor={primaryColor} />
            <EmployeeIdentitySection identity={identity} primaryColor={primaryColor} />

            <div className="mb-6">
            <StatusNote primaryColor={primaryColor} ready={identity.identityReady}>
              {identity.identityReady ? (
                <>Ready to start, {identity.resolvedEmployeeName}.</>
              ) : (
                "Please fill in your name, employee ID and department before starting the conversation."
              )}
            </StatusNote>
            </div>

            {submitError && phase === "identity" ? (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-700">
                {submitError}
              </p>
            ) : null}

            <PrimaryAction
              primaryColor={primaryColor}
              disabled={!identity.identityReady || !sortedQuestions.length}
              onClick={handleStartConversation}
            >
              <Mic size={18} />
              Start conversation
            </PrimaryAction>
          </div>
        )}

        {phase === "intro" && (
          <div className="p-6 space-y-4 text-center">
            <div
              className="inline-flex items-center gap-3 px-5 py-4 rounded-2xl"
              style={{ backgroundColor: `${primaryColor}18` }}
            >
              <Volume2 size={28} style={{ color: primaryColor }} className={isPlayingPrompt ? "animate-pulse" : ""} />
              <div className="text-left">
                <p className="font-semibold text-gray-800">AI voice intro</p>
                <p className="text-sm text-gray-600">
                  {isPlayingPrompt ? "கேட்டுக்கொண்டிருக்கிறீர்கள்…" : "தயாராக இருங்கள்…"}
                </p>
              </div>
            </div>
            {!isPlayingPrompt && (
              <button
                type="button"
                onClick={() => {
                  void playIntroAudio().then((ok) => {
                    if (!ok) goToFirstQuestion();
                  });
                }}
                className="w-full py-3 rounded-xl font-bold text-white"
                style={{ backgroundColor: primaryColor }}
              >
                {introAudioSrc ? "Play intro" : "Continue to questions"}
              </button>
            )}
          </div>
        )}

        {phase === "question" && currentQuestion && (
          <div className="p-6 space-y-4">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                <span>
                  Question {questionIndex + 1} of {sortedQuestions.length}
                </span>
                <span>AI assistant</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${((questionIndex + 1) / Math.max(1, sortedQuestions.length)) * 100}%`,
                    backgroundColor: primaryColor,
                  }}
                />
              </div>
            </div>

            {questionPhase === "prompt" && (
              <div className="py-8 text-center space-y-4">
                <div
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-full text-white"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Volume2 size={22} className={isPlayingPrompt ? "animate-pulse" : ""} />
                  <span>{isPlayingPrompt ? "கேள்வி படிக்கிறது…" : "கேள்வி தயார்…"}</span>
                </div>
                <p className="text-lg font-medium text-gray-800 leading-relaxed px-2">
                  {currentQuestion.textTa}
                </p>
              </div>
            )}

            {questionPhase === "think" && (
              <div className="py-12 text-center">
                <p className="text-lg font-semibold text-gray-800 mb-2">சிறிது நேரம் யோசியுங்கள்…</p>
                <p className="text-5xl font-bold tabular-nums" style={{ color: primaryColor }}>
                  {thinkCountdown}
                </p>
                <p className="text-sm text-gray-500 mt-4">{currentQuestion.textTa}</p>
              </div>
            )}

            {questionPhase === "record" && (
              <div className="py-8 text-center space-y-4">
                <p className="text-lg font-medium text-gray-800">{currentQuestion.textTa}</p>
                <div
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-white animate-pulse"
                  style={{ backgroundColor: primaryColor }}
                >
                  <Mic size={20} />
                  Listening…
                </div>
                {statusHint ? <p className="text-sm text-gray-600">{statusHint}</p> : null}
              </div>
            )}

            {questionPhase === "processing" && (
              <div className="py-12 flex flex-col items-center gap-3 text-gray-600">
                <Loader className="animate-spin" size={32} />
                <p>{statusHint || "Processing…"}</p>
              </div>
            )}

            {submitError ? (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
                {submitError}
              </p>
            ) : null}
          </div>
        )}

        {phase === "complete" && (
          <div className="px-6 py-6 md:px-10 md:py-8 space-y-6">
            <div className="text-center">
              <h3 className="text-xl font-semibold tracking-tight text-gray-900 mb-1">Conversation complete</h3>
              <p className="text-sm text-gray-500">
                Add an optional remark below, then submit your feedback.
              </p>
            </div>
            <FeedbackRemarkField value={remark} onChange={setRemark} />
            {submitError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
                {submitError}
              </p>
            ) : null}
            <PrimaryAction primaryColor={primaryColor} onClick={() => void submitAll()}>
              Submit feedback
            </PrimaryAction>
          </div>
        )}

        {phase === "submitting" && (
          <div className="p-12 flex flex-col items-center gap-3 text-gray-600">
            <Loader className="animate-spin" size={36} />
            <p className="font-medium">Submitting your feedback…</p>
          </div>
        )}
      </div>

      <EmployeeFooter onBack={() => navigate("/feedback")} />
    </div>
  );
}
