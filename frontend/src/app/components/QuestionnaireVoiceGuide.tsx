import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader, Mic, Volume2 } from "lucide-react";
import {
  coerceTranscriptText,
  resolveUploadUrl,
  type FeedbackType,
  type QuestionnaireQuestion,
} from "../lib/api";
import { transcribeVoiceRecordingChunked } from "../lib/audioTranscription";
import { loadBrandingSettings } from "../lib/branding";
import { isAnswered, type AnswerMap } from "../lib/useQuestionnaire";
import {
  QUESTIONNAIRE_TEXT,
  SPEECH_LOCALE,
  questionText,
  type QuestionnaireLanguage,
} from "../lib/questionnaireLanguage";
import { QuestionnaireFields } from "./QuestionnaireFields";

/**
 * AI Voice Guide for the new-joiner and exit questionnaires. It follows the same conversation as the
 * general AI Voice Guide: intro, then for each question the AI reads it aloud, the employee gets a
 * moment to think, the guide listens until they pause, understands the answer and moves on.
 * Answers go into the same map the typed form edits, so submitting works either way.
 */

const DEFAULT_THINK_SECONDS = 3;
const MAX_RECORD_MS = 45000;
const SILENCE_MS = 2200;
const MIN_RECORD_MS = 900;
const SILENCE_RMS_THRESHOLD = 7;
const MAX_ATTEMPTS = 3;

type Phase = "ready" | "intro" | "question" | "complete";
type QuestionPhase = "prompt" | "think" | "record" | "processing" | "stuck";

type Props = {
  feedbackType: Exclude<FeedbackType, "general">;
  questions: QuestionnaireQuestion[];
  answers: AnswerMap;
  onChange: (next: AnswerMap) => void;
  primaryColor: string;
  lang: QuestionnaireLanguage;
  /** Switch to the plain typed form. */
  onSwitchToTyping: () => void;
  /** Tells the form when every question has been asked, so it can show Remark and Submit. */
  onFinishedChange?: (finished: boolean) => void;
  /** False until the employee's details are filled in; the guide will not start before then. */
  canStart?: boolean;
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

/** Last resort when the generated audio cannot play: read the text with the browser's own voice. */
async function speakWithBrowserVoice(text: string, lang: QuestionnaireLanguage): Promise<boolean> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await sleep(200);
  }
  synth.resume();
  const locale = SPEECH_LOCALE[lang];
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(locale.slice(0, 2)));
  if (!voice && lang === "ta") return false;
  return new Promise<boolean>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    if (voice) utterance.voice = voice;
    let started = false;
    const watchdog = window.setTimeout(() => {
      if (!started) {
        synth.cancel();
        resolve(false);
      }
    }, 3000);
    utterance.onstart = () => {
      started = true;
      window.clearTimeout(watchdog);
    };
    utterance.onend = () => {
      window.clearTimeout(watchdog);
      resolve(true);
    };
    utterance.onerror = () => {
      window.clearTimeout(watchdog);
      resolve(false);
    };
    synth.speak(utterance);
  });
}

export function QuestionnaireVoiceGuide({
  feedbackType,
  questions,
  answers,
  onChange,
  primaryColor,
  lang,
  onSwitchToTyping,
  onFinishedChange,
  canStart = true,
}: Props) {
  const T = QUESTIONNAIRE_TEXT[lang];
  const [phase, setPhase] = useState<Phase>("ready");
  const [questionPhase, setQuestionPhase] = useState<QuestionPhase>("prompt");
  const [index, setIndex] = useState(0);
  const [thinkSeconds, setThinkSeconds] = useState(DEFAULT_THINK_SECONDS);
  const [skipIntro, setSkipIntro] = useState(false);
  const [skipThink, setSkipThink] = useState(false);
  const [thinkCountdown, setThinkCountdown] = useState(DEFAULT_THINK_SECONDS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [introWaiting, setIntroWaiting] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef(0);
  const silenceRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const stoppingRef = useRef(false);
  const attemptsRef = useRef(0);
  /** Bumped whenever the flow is cancelled or restarted, so stale async steps stop quietly. */
  const flowRef = useRef(0);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const questionsRef = useRef(questions);
  questionsRef.current = questions;

  const total = questions.length;
  const question = questions[index] ?? null;

  useEffect(() => {
    void loadBrandingSettings().then((b) => {
      setThinkSeconds(b.botThinkSeconds);
      setSkipIntro(b.botSkipIntro);
      setSkipThink(b.botSkipThinkCountdown);
    });
  }, []);

  const stopCapture = useCallback(() => {
    if (recordTimerRef.current) window.clearTimeout(recordTimerRef.current);
    if (silenceRef.current) window.clearInterval(silenceRef.current);
    recordTimerRef.current = 0;
    silenceRef.current = 0;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const stopAudio = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setIsPlaying(false);
  }, []);

  useEffect(
    () => () => {
      flowRef.current += 1;
      stopCapture();
      stopAudio();
      try {
        recorderRef.current?.stop();
      } catch {
        // already stopped
      }
    },
    [stopAudio, stopCapture]
  );

  /** Play a generated clip; fall back to the browser voice if the clip cannot play. */
  const say = useCallback(
    async (url: string, text: string): Promise<boolean> => {
      setIsPlaying(true);
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      const played = await new Promise<boolean>((resolve) => {
        el.onended = () => resolve(true);
        el.onerror = () => resolve(false);
        el.src = url;
        el.play().catch(() => resolve(false));
      });
      el.onended = null;
      el.onerror = null;
      const ok = played || (await speakWithBrowserVoice(text, lang));
      setIsPlaying(false);
      return ok;
    },
    [lang]
  );

  /** Append what was said to the answer for this question (so a second try adds to the first). */
  const applyTranscript = useCallback(
    (q: QuestionnaireQuestion, transcript: string): boolean => {
      const existing = answersRef.current[q.id]?.value;
      const prefix = typeof existing === "string" && existing.trim() ? `${existing.trim()} ` : "";
      onChange({ ...answersRef.current, [q.id]: { value: `${prefix}${transcript}`.slice(0, 2000) } });
      return true;
    },
    [onChange]
  );

  // The steps below call each other, so they live behind refs to always use the latest render.
  const runQuestionRef = useRef<(i: number) => Promise<void>>(async () => {});
  const listenRef = useRef<(flow: number) => Promise<void>>(async () => {});
  const afterAnswerRef = useRef<(flow: number, understood: boolean) => Promise<void>>(async () => {});

  const finishRecording = useCallback(
    async (flow: number) => {
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      const recorder = recorderRef.current;
      const q = questionsRef.current[indexRef.current];
      if (!recorder || recorder.state === "inactive" || !q) {
        stoppingRef.current = false;
        stopCapture();
        return;
      }
      setQuestionPhase("processing");
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
      stopCapture();
      recorderRef.current = null;
      chunksRef.current = [];
      stoppingRef.current = false;
      if (flow !== flowRef.current) return;

      if (!blob) {
        setNotice(T.noVoice);
        await afterAnswerRef.current(flow, false);
        return;
      }
      try {
        const ext = blob.type.includes("mp4") ? "m4a" : "webm";
        const { transcript: raw } = await transcribeVoiceRecordingChunked(blob, `answer.${ext}`, SPEECH_LOCALE[lang]);
        if (flow !== flowRef.current) return;
        const transcript = coerceTranscriptText(raw).trim();
        if (!transcript || transcript === "(No speech detected.)") {
          setNotice(T.notHeard);
          await afterAnswerRef.current(flow, false);
          return;
        }
        setNotice(null);
        await afterAnswerRef.current(flow, applyTranscript(q, transcript));
      } catch (e) {
        if (flow !== flowRef.current) return;
        setNotice(e instanceof Error ? e.message : T.transcribeFailed);
        await afterAnswerRef.current(flow, false);
      }
    },
    [applyTranscript, lang, stopCapture, T]
  );

  const startRecording = useCallback(
    async (flow: number) => {
      if (flow !== flowRef.current) return;
      stopCapture();
      chunksRef.current = [];
      stoppingRef.current = false;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setNotice(T.micDenied);
        setQuestionPhase("stuck");
        return;
      }
      if (flow !== flowRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      try {
        const mime = pickRecorderMime();
        const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        recorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(250);
        setQuestionPhase("record");

        // Stop when the employee pauses after speaking.
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const startedAt = Date.now();
        let spoke = false;
        let quietSince = 0;
        silenceRef.current = window.setInterval(() => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const byte of data) sum += ((byte - 128) / 128) ** 2;
          const loud = Math.sqrt(sum / data.length) * 100 > SILENCE_RMS_THRESHOLD;
          if (loud) {
            spoke = true;
            quietSince = 0;
          } else if (spoke && Date.now() - startedAt > MIN_RECORD_MS) {
            if (!quietSince) quietSince = Date.now();
            else if (Date.now() - quietSince >= SILENCE_MS) void finishRecording(flow);
          }
        }, 180);
        recordTimerRef.current = window.setTimeout(() => void finishRecording(flow), MAX_RECORD_MS);
      } catch {
        stopCapture();
        setNotice(T.noRecorder);
        setQuestionPhase("stuck");
      }
    },
    [finishRecording, stopCapture, T]
  );

  /** Think-time countdown, then listen (same as the general voice guide). */
  const listen = useCallback(
    async (flow: number) => {
      if (!skipThink) {
        setQuestionPhase("think");
        for (let left = Math.min(30, Math.max(1, thinkSeconds)); left > 0; left -= 1) {
          setThinkCountdown(left);
          await sleep(1000);
          if (flow !== flowRef.current) return;
        }
      }
      await startRecording(flow);
    },
    [skipThink, startRecording, thinkSeconds]
  );
  listenRef.current = listen;

  const indexRef = useRef(index);
  indexRef.current = index;

  const afterAnswer = useCallback(
    async (flow: number, understood: boolean) => {
      if (flow !== flowRef.current) return;
      if (understood) {
        attemptsRef.current = 0;
        await sleep(900);
        if (flow !== flowRef.current) return;
        const next = indexRef.current + 1;
        if (next >= questionsRef.current.length) {
          setPhase("complete");
          setNotice(null);
          onFinishedChange?.(true);
          return;
        }
        await runQuestionRef.current(next);
        return;
      }
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setQuestionPhase("stuck");
        return;
      }
      // Give them time to read what went wrong, then listen again.
      setQuestionPhase("think");
      await sleep(2200);
      if (flow !== flowRef.current) return;
      await listenRef.current(flow);
    },
    [onFinishedChange]
  );
  afterAnswerRef.current = afterAnswer;

  const runQuestion = useCallback(
    async (i: number) => {
      const flow = ++flowRef.current;
      const q = questionsRef.current[i];
      if (!q) return;
      stopCapture();
      stopAudio();
      attemptsRef.current = 0;
      indexRef.current = i;
      setIndex(i);
      setNotice(null);
      setPhase("question");
      setQuestionPhase("prompt");
      const url = resolveUploadUrl(`/api/tts/question/${feedbackType}/${q.id}?lang=${lang}`) ?? "";
      const spoke = await say(url, questionText(q, lang));
      if (flow !== flowRef.current) return;
      if (!spoke) {
        setNotice(lang === "ta" ? T.noTamilVoice : T.noVoiceOutput);
        await sleep(4000);
        if (flow !== flowRef.current) return;
      }
      await listenRef.current(flow);
    },
    [feedbackType, lang, say, stopAudio, stopCapture, T]
  );
  runQuestionRef.current = runQuestion;

  const startConversation = useCallback(async () => {
    if (!canStart || !questions.length) return;
    const flow = ++flowRef.current;
    onFinishedChange?.(false);
    if (skipIntro) {
      await runQuestion(0);
      return;
    }
    setPhase("intro");
    setIntroWaiting(false);
    const url = resolveUploadUrl(`/api/tts/intro/${feedbackType}?lang=${lang}`) ?? "";
    // The intro text is spoken by the clip; fall back to the browser voice with a short line.
    const ok = await say(url, T.startBody(total));
    if (flow !== flowRef.current) return;
    if (ok) {
      await runQuestion(0);
    } else {
      setIntroWaiting(true);
    }
  }, [canStart, feedbackType, lang, onFinishedChange, questions.length, runQuestion, say, skipIntro, T, total]);

  const restart = useCallback(() => {
    flowRef.current += 1;
    stopCapture();
    stopAudio();
    onFinishedChange?.(false);
    void runQuestion(0);
  }, [onFinishedChange, runQuestion, stopAudio, stopCapture]);

  if (!questions.length) return null;

  const shell = "rounded-2xl border border-gray-200 bg-white p-4 md:p-6";
  const pill = "inline-flex items-center gap-2 rounded-full px-5 py-3 text-white";

  if (phase === "ready") {
    return (
      <div className={`${shell} text-center`}>
        <div
          className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white"
          style={{ backgroundColor: primaryColor }}
        >
          <Bot size={30} />
        </div>
        <h4 className="text-lg font-semibold text-gray-900" lang={lang}>
          {T.startTitle}
        </h4>
        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-gray-600" lang={lang}>
          {T.startBody(total)}
        </p>
        <button
          type="button"
          onClick={() => void startConversation()}
          disabled={!canStart}
          className="mx-auto mt-5 inline-flex h-12 items-center gap-2 rounded-xl px-6 text-base font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:brightness-100"
          style={{ backgroundColor: primaryColor }}
          lang={lang}
        >
          <Mic size={18} />
          {T.startConversation}
        </button>
        {canStart ? null : (
          <p className="mt-2 text-sm font-medium text-amber-800" lang={lang}>
            {T.detailsFirst}
          </p>
        )}
        <div className="mt-3">
          <button type="button" onClick={onSwitchToTyping} className="text-sm font-medium underline" style={{ color: primaryColor }}>
            {T.typeMyAnswers}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "intro") {
    return (
      <div className="space-y-5 py-4 text-center">
        <div
          className="inline-flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ backgroundColor: `${primaryColor}18` }}
        >
          <Volume2 size={28} style={{ color: primaryColor }} className={isPlaying ? "animate-pulse" : ""} />
          <div className="text-left">
            <p className="font-semibold text-gray-800" lang={lang}>
              {T.introTitle}
            </p>
            <p className="text-sm text-gray-600" lang={lang}>
              {isPlaying ? T.introPlaying : T.introReady}
            </p>
          </div>
        </div>
        {introWaiting ? (
          <div>
            <button
              type="button"
              onClick={() => void runQuestion(0)}
              className="w-full rounded-xl py-3 font-bold text-white sm:w-auto sm:px-8"
              style={{ backgroundColor: primaryColor }}
              lang={lang}
            >
              {T.continueToQuestions}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <div className="space-y-4">
        <div className={shell}>
          <p className="font-semibold text-gray-900" lang={lang}>
            {T.finishedTitle}
          </p>
          <p className="mt-1 text-sm text-gray-600" lang={lang}>
            {T.finishedBody}
          </p>
        </div>
        <QuestionnaireFields questions={questions} answers={answers} onChange={onChange} primaryColor={primaryColor} lang={lang} />
        <button type="button" onClick={restart} className="text-sm font-medium underline" style={{ color: primaryColor }}>
          {T.askFromStart}
        </button>
      </div>
    );
  }

  const qText = question ? questionText(question, lang) : "";
  const required = question?.required ? <span className="text-red-600"> *</span> : null;
  const answered = question ? isAnswered(question, answers) : false;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
          <span lang={lang}>{T.questionOf(index + 1, total)}</span>
          <span lang={lang}>{T.assistant}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${((index + 1) / Math.max(1, total)) * 100}%`, backgroundColor: primaryColor }}
          />
        </div>
      </div>

      {questionPhase === "prompt" && (
        <div className="space-y-4 py-8 text-center">
          <div className={pill} style={{ backgroundColor: primaryColor }}>
            <Volume2 size={22} className={isPlaying ? "animate-pulse" : ""} />
            <span lang={lang}>{T.reading}</span>
          </div>
          <p className="px-2 text-lg font-medium leading-relaxed text-gray-800" lang={lang}>
            {qText}
            {required}
          </p>
        </div>
      )}

      {questionPhase === "think" && (
        <div className="py-12 text-center">
          <p className="mb-2 text-lg font-semibold text-gray-800" lang={lang}>
            {T.thinkMoment}
          </p>
          <p className="text-5xl font-bold tabular-nums" style={{ color: primaryColor }}>
            {thinkCountdown}
          </p>
          <p className="mt-4 text-sm text-gray-500" lang={lang}>
            {qText}
          </p>
        </div>
      )}

      {questionPhase === "record" && (
        <div className="space-y-4 py-8 text-center">
          <p className="px-2 text-lg font-medium text-gray-800" lang={lang}>
            {qText}
            {required}
          </p>
          <div className={`${pill} animate-pulse`} style={{ backgroundColor: primaryColor }}>
            <Mic size={20} />
            <span lang={lang}>{T.listeningShort}</span>
          </div>
          <p className="text-sm text-gray-600" lang={lang}>
            {T.speakHint}
          </p>
        </div>
      )}

      {questionPhase === "processing" && (
        <div className="flex flex-col items-center gap-3 py-12 text-gray-600">
          <Loader className="animate-spin" size={32} />
          <p lang={lang}>{T.understanding}</p>
        </div>
      )}

      {questionPhase === "stuck" && (
        <div className="space-y-4 py-8 text-center">
          <p className="px-2 text-lg font-medium text-gray-800" lang={lang}>
            {qText}
            {required}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                attemptsRef.current = 0;
                setNotice(null);
                const flow = ++flowRef.current;
                void listenRef.current(flow);
              }}
              className={`${pill} hover:brightness-110`}
              style={{ backgroundColor: primaryColor }}
              lang={lang}
            >
              <Mic size={18} />
              {T.tryAgain}
            </button>
            {!question?.required || answered ? (
              <button
                type="button"
                onClick={() => {
                  attemptsRef.current = 0;
                  void afterAnswerRef.current(flowRef.current, true);
                }}
                className="h-12 rounded-full border border-gray-300 bg-white px-6 text-sm font-semibold text-gray-700 hover:border-gray-400"
                lang={lang}
              >
                {T.skip}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {notice ? (
        <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600" lang={lang}>
          {notice}
        </p>
      ) : null}

      <div className="text-center">
        <button type="button" onClick={onSwitchToTyping} className="text-sm font-medium underline" style={{ color: primaryColor }}>
          {T.typeInstead}
        </button>
      </div>
    </div>
  );
}
