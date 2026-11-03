import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Check, Loader, RotateCcw } from "lucide-react";
import {
  coerceTranscriptText,
  inferVoiceRatingFromTranscript,
  TranscribeApiError,
  type SpeechLanguageCode,
} from "../lib/api";
import { transcribeVoiceRecordingChunked } from "../lib/audioTranscription";
import {
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
} from "../lib/branding";

type RecordingState = "idle" | "recording" | "processing" | "completed";

/** Sarvam REST works best ~30s per clip — auto-rotate recorder and merge transcripts for longer speech */
const SEGMENT_MS = 22000;

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

function mergeSegments(map: Map<number, string>): string {
  const keys = [...map.keys()].sort((a, b) => a - b);
  return keys
    .map((k) => map.get(k) ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FeedbackVoiceSectionProps {
  /** Name and department are filled in — recording is allowed. */
  identityReady: boolean;
  primaryColor: string;
  resetRevision: number;
  onVoiceSuccess: (transcript: string, inferredRating: number) => void;
  onVoiceCleared: () => void;
  onVoiceError: (message: string | null) => void;
  /** Full-session recording blob for server upload (parallel to segmented transcription). */
  onVoiceRecordingReady?: (blob: Blob | null) => void;
  /** Compact UI for staff remark capture (no employee rating needed). */
  variant?: "default" | "staffRemarks";
  /** Skip OpenRouter rating inference (staff notes only need transcript). */
  skipRatingInference?: boolean;
  /** Restore transcript when returning from the remark step. */
  restoredTranscript?: string;
  /** Fires when one or more segments are stuck waiting for a connection to transcribe. */
  onTranscriptionPendingChange?: (pending: boolean) => void;
}

export function FeedbackVoiceSection({
  identityReady,
  primaryColor,
  resetRevision,
  onVoiceSuccess,
  onVoiceCleared,
  onVoiceError,
  onVoiceRecordingReady,
  variant = "default",
  skipRatingInference = false,
  maxRecordingSecondsOverride,
  restoredTranscript,
  onTranscriptionPendingChange,
}: FeedbackVoiceSectionProps) {
  const isStaffRemarks = variant === "staffRemarks";
  const [speechLanguageCode, setSpeechLanguageCode] =
    useState<SpeechLanguageCode>("unknown");
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [localTranscript, setLocalTranscript] = useState("");
  /** Shown during recording — how many parts have finished uploading (not guaranteed order) */
  const [segmentsDoneUi, setSegmentsDoneUi] = useState(0);
  const [maxRecordingSeconds, setMaxRecordingSeconds] = useState(120);
  const [secondsRemaining, setSecondsRemaining] = useState(120);
  const [transcriptionPending, setTranscriptionPending] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const segmentTimerRef = useRef(0);
  const countdownIntervalRef = useRef(0);
  const finishRecordingPipelineRef = useRef<() => void>(() => {});

  /** Monotonic segment index assigned when a clip is closed */
  const nextSegmentIdxRef = useRef(0);
  const transcriptsBySegmentRef = useRef(new Map<number, string>());
  const transcriptionJobsRef = useRef<Promise<void>[]>([]);
  /** Segments whose transcription failed transiently (offline, rate-limited, server error) — kept so we can retry, never dropped. */
  const pendingSegmentBlobsRef = useRef(new Map<number, { blob: Blob; filename: string }>());
  const lastRatingRef = useRef(3);
  const retryTimerRef = useRef(0);
  const retryAttemptRef = useRef(0);

  const rotateBusyRef = useRef(false);
  const finishingSessionRef = useRef(false);
  const recordingStateRef = useRef<RecordingState>("idle");

  /** One continuous recorder for archiving the whole session (segmented recorder still used for STT). */
  const archiveRecorderRef = useRef<MediaRecorder | null>(null);
  const archiveChunksRef = useRef<BlobPart[]>([]);
  const archiveMimeRef = useRef<string>("audio/webm");

  const onVoiceRecordingReadyRef = useRef(onVoiceRecordingReady);
  const onVoiceErrorRef = useRef(onVoiceError);
  const onVoiceSuccessRef = useRef(onVoiceSuccess);
  const onTranscriptionPendingChangeRef = useRef(onTranscriptionPendingChange);
  onVoiceRecordingReadyRef.current = onVoiceRecordingReady;
  onVoiceErrorRef.current = onVoiceError;
  onVoiceSuccessRef.current = onVoiceSuccess;
  onTranscriptionPendingChangeRef.current = onTranscriptionPendingChange;

  const restoredAppliedRef = useRef(false);
  const skipResetForRestoreRef = useRef(Boolean(restoredTranscript?.trim()));
  const [liveTranscript, setLiveTranscript] = useState("");

  useEffect(() => {
    if (!restoredTranscript?.trim() || restoredAppliedRef.current) return;
    restoredAppliedRef.current = true;
    const text = restoredTranscript.trim();
    setLocalTranscript(text);
    setRecordingState("completed");
  }, [restoredTranscript]);

  const stopArchiveRecorderAsync = useCallback(
    async (notify: boolean) => {
      const ar = archiveRecorderRef.current;
      if (!ar || ar.state === "inactive") {
        archiveRecorderRef.current = null;
        archiveChunksRef.current = [];
        if (notify) onVoiceRecordingReady?.(null);
        return;
      }
      await new Promise<void>((resolve) => {
        ar.onstop = () => {
          try {
            if (notify) {
              const blob = new Blob(archiveChunksRef.current, {
                type: ar.mimeType || archiveMimeRef.current,
              });
              onVoiceRecordingReady?.(blob.size > 0 ? blob : null);
            }
          } catch {
            if (notify) onVoiceRecordingReady?.(null);
          }
          archiveChunksRef.current = [];
          archiveRecorderRef.current = null;
          resolve();
        };
        try {
          ar.stop();
        } catch {
          if (notify) onVoiceRecordingReady?.(null);
          archiveChunksRef.current = [];
          archiveRecorderRef.current = null;
          resolve();
        }
      });
    },
    [onVoiceRecordingReady]
  );

  useEffect(() => {
    recordingStateRef.current = recordingState;
  }, [recordingState]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    void loadBrandingSettings().then((b) => {
      const seconds = maxRecordingSecondsOverride ?? b.voiceRecordingMaxSeconds;
      setMaxRecordingSeconds(seconds);
      setSecondsRemaining(seconds);
    });
    return onBrandingSettingsChange(() => {
      const b = getBrandingSettings();
      const seconds = maxRecordingSecondsOverride ?? b.voiceRecordingMaxSeconds;
      setMaxRecordingSeconds(seconds);
      if (recordingStateRef.current !== "recording") {
        setSecondsRemaining(seconds);
      }
    });
  }, [maxRecordingSecondsOverride]);

  const clearSegmentTimer = useCallback(() => {
    if (segmentTimerRef.current) {
      window.clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = 0;
    }
  }, []);

  const clearCountdownTimer = useCallback(() => {
    if (countdownIntervalRef.current) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = 0;
    }
  }, []);

  const startCountdown = useCallback(() => {
    clearCountdownTimer();
    setSecondsRemaining(maxRecordingSeconds);
    countdownIntervalRef.current = window.setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearCountdownTimer();
          window.setTimeout(() => {
            void finishRecordingPipelineRef.current();
          }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearCountdownTimer, maxRecordingSeconds]);

  function scheduleSegmentRotate() {
    clearSegmentTimer();
    segmentTimerRef.current = window.setTimeout(() => {
      void rotateSegmentAutomatically();
    }, SEGMENT_MS);
  }

  /**
   * Segment transcription failed for a transient reason (offline, Sarvam
   * rate-limited us with 429, a server-side 5xx, or 403 which Sarvam also
   * returns for plan/concurrency limits) — worth retrying — vs. the API
   * permanently rejecting this clip's content (plain 400: too short/silent).
   */
  function isRetryableFailure(err: unknown): boolean {
    if (typeof navigator !== "undefined" && !navigator.onLine) return true;
    if (err instanceof TypeError) return true;
    if (err instanceof TranscribeApiError) {
      return err.status === 429 || err.status === 403 || err.status >= 500;
    }
    return false;
  }

  const retryPendingSegmentsRef = useRef<() => void>(() => {});
  const scheduleRetryRef = useRef<() => void>(() => {});

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = 0;
    }
  }, []);

  /**
   * 429/403/5xx aren't connectivity problems, so the browser's `online` event
   * never fires for them — poll with backoff instead (4s, 8s, 16s, capped at 30s).
   */
  const scheduleRetry = useCallback(() => {
    clearRetryTimer();
    const attempt = retryAttemptRef.current;
    const delayMs = Math.min(30000, 4000 * 2 ** attempt);
    retryAttemptRef.current = attempt + 1;
    retryTimerRef.current = window.setTimeout(() => {
      retryPendingSegmentsRef.current();
    }, delayMs);
  }, [clearRetryTimer]);
  scheduleRetryRef.current = scheduleRetry;

  const enqueueTranscription = useCallback(async (segmentIdx: number, blob: Blob) => {
    if (!blob.size) {
      transcriptsBySegmentRef.current.set(segmentIdx, "");
      setSegmentsDoneUi((n) => n + 1);
      return;
    }
    const ext =
      blob.type.includes("mp4") || blob.type.includes("m4a")
        ? "m4a"
        : blob.type.includes("webm")
          ? "webm"
          : "audio";
    const filename = `seg-${segmentIdx}.${ext}`;

    try {
      const { transcript: raw } = await transcribeVoiceRecordingChunked(
        blob,
        filename,
        speechLanguageCode
      );
      const t = coerceTranscriptText(raw).trim();
      transcriptsBySegmentRef.current.set(segmentIdx, t);
      pendingSegmentBlobsRef.current.delete(segmentIdx);
    } catch (err) {
      if (isRetryableFailure(err)) {
        // Offline, rate-limited, or a server hiccup — keep the audio to retry, never drop it.
        pendingSegmentBlobsRef.current.set(segmentIdx, { blob, filename });
      } else {
        // The API rejected this clip's content (e.g. too short/silent) — only that
        // segment's text is lost, the rest of the recording still comes through.
        transcriptsBySegmentRef.current.set(segmentIdx, "");
      }
    }
    setSegmentsDoneUi((n) => n + 1);
    setLiveTranscript(mergeSegments(transcriptsBySegmentRef.current));
    if (pendingSegmentBlobsRef.current.has(segmentIdx)) scheduleRetryRef.current();
  }, [speechLanguageCode]);

  /** Re-attempts any segments that failed transiently (offline, rate-limited, server error). */
  const retryPendingSegments = useCallback(async () => {
    if (!pendingSegmentBlobsRef.current.size) return;
    const entries = [...pendingSegmentBlobsRef.current.entries()];
    for (const [segmentIdx, { blob, filename }] of entries) {
      try {
        const { transcript: raw } = await transcribeVoiceRecordingChunked(
          blob,
          filename,
          speechLanguageCode
        );
        const t = coerceTranscriptText(raw).trim();
        transcriptsBySegmentRef.current.set(segmentIdx, t);
        pendingSegmentBlobsRef.current.delete(segmentIdx);
      } catch (err) {
        if (!isRetryableFailure(err)) {
          // The clip itself was rejected — stop retrying it.
          transcriptsBySegmentRef.current.set(segmentIdx, "");
          pendingSegmentBlobsRef.current.delete(segmentIdx);
        }
        // else: still failing transiently — leave queued for the next retry.
      }
    }

    const merged = mergeSegments(transcriptsBySegmentRef.current);
    setLiveTranscript(merged);
    const stillPending = pendingSegmentBlobsRef.current.size > 0;
    setTranscriptionPending(stillPending);
    onTranscriptionPendingChangeRef.current?.(stillPending);

    if (stillPending) {
      scheduleRetryRef.current();
    } else {
      clearRetryTimer();
      retryAttemptRef.current = 0;
    }

    if (
      !stillPending &&
      (recordingStateRef.current === "completed" || recordingStateRef.current === "processing")
    ) {
      const cleanedTranscript = merged.trim();
      let rating = lastRatingRef.current;
      if (!skipRatingInference && cleanedTranscript) {
        try {
          const inferred = await inferVoiceRatingFromTranscript(cleanedTranscript);
          if (Number.isFinite(inferred.rating)) {
            rating = Math.min(5, Math.max(1, Math.round(inferred.rating)));
          }
        } catch {
          /* keep the earlier fallback rating */
        }
      }
      lastRatingRef.current = rating;
      const cleaned = cleanedTranscript || "(No speech detected.)";
      setLocalTranscript(cleaned);
      onVoiceErrorRef.current?.(null);
      onVoiceSuccessRef.current?.(cleaned, rating);
    }
  }, [clearRetryTimer, skipRatingInference, speechLanguageCode]);
  retryPendingSegmentsRef.current = () => {
    void retryPendingSegments();
  };

  useEffect(() => {
    // Covers real connectivity drops immediately; the backoff timer above
    // covers rate-limit/server errors where the browser never goes offline.
    window.addEventListener("online", retryPendingSegments);
    return () => window.removeEventListener("online", retryPendingSegments);
  }, [retryPendingSegments]);

  useEffect(() => clearRetryTimer, [clearRetryTimer]);

  const attachRecorderCallbacks = useCallback((recorder: MediaRecorder) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = () => {
      clearSegmentTimer();
      onVoiceError("Voice capture failed.");
      setRecordingState("idle");
      stopTracks();
      mediaRecorderRef.current = null;
    };
  }, [clearSegmentTimer, onVoiceError, stopTracks]);

  const createAndStartRecorder = useCallback(
    (stream: MediaStream) => {
      const mimeType = pickRecorderMime();
      mimeRef.current = mimeType || "audio/webm";
      chunksRef.current = [];
      try {
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        attachRecorderCallbacks(recorder);
        recorder.start(250);
      } catch {
        stopTracks();
        onVoiceError("This browser cannot capture voice for upload.");
        setRecordingState("idle");
      }
    },
    [attachRecorderCallbacks, onVoiceError, stopTracks]
  );

  /** Stops active recorder → blob → enqueue transcribe → optionally start next recorder */
  const finalizeCurrentSegment = useCallback(
    async (stopFully: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        if (stopFully) {
          await stopArchiveRecorderAsync(true);
          stopTracks();
        }
        return;
      }

      clearSegmentTimer();

      const segmentIdx = nextSegmentIdxRef.current;
      nextSegmentIdxRef.current += 1;

      const done = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || mimeRef.current,
            });
            resolve(blob);
          } catch (e) {
            reject(e instanceof Error ? e : new Error("Blob error"));
          }
        };
        recorder.onerror = () => reject(new Error("Recorder error"));
        try {
          recorder.stop();
        } catch (e) {
          reject(e instanceof Error ? e : new Error("Stop failed"));
        }
      });

      mediaRecorderRef.current = null;

      let blob: Blob;
      try {
        blob = await done;
      } catch {
        blob = new Blob([]);
      }

      transcriptionJobsRef.current.push(enqueueTranscription(segmentIdx, blob));

      if (!stopFully) {
        const stream = streamRef.current;
        if (stream?.active && recordingStateRef.current === "recording") {
          createAndStartRecorder(stream);
          scheduleSegmentRotate();
        }
      } else {
        await stopArchiveRecorderAsync(true);
        stopTracks();
      }
    },
    [
      clearSegmentTimer,
      createAndStartRecorder,
      enqueueTranscription,
      stopArchiveRecorderAsync,
      stopTracks,
    ]
  );

  const rotateSegmentAutomatically = useCallback(async () => {
    if (finishingSessionRef.current || recordingStateRef.current !== "recording") return;
    if (rotateBusyRef.current) {
      segmentTimerRef.current = window.setTimeout(() => {
        void rotateSegmentAutomatically();
      }, 450);
      return;
    }
    rotateBusyRef.current = true;
    try {
      await finalizeCurrentSegment(false);
    } finally {
      rotateBusyRef.current = false;
    }
  }, [finalizeCurrentSegment]);

  useEffect(() => {
    return () => {
      clearCountdownTimer();
      clearSegmentTimer();
      mediaRecorderRef.current?.stop();
      try {
        if (archiveRecorderRef.current && archiveRecorderRef.current.state !== "inactive") {
          archiveRecorderRef.current.stop();
        }
      } catch {
        /* noop */
      }
      archiveRecorderRef.current = null;
      archiveChunksRef.current = [];
      stopTracks();
    };
  }, [clearCountdownTimer, clearSegmentTimer, stopTracks]);

  useEffect(() => {
    if (skipResetForRestoreRef.current) {
      skipResetForRestoreRef.current = false;
      return;
    }
    clearCountdownTimer();
    clearSegmentTimer();
    mediaRecorderRef.current?.stop();
    stopTracks();
    mediaRecorderRef.current = null;
    setRecordingState("idle");
    setLocalTranscript("");
    setLiveTranscript("");
    setSegmentsDoneUi(0);
    nextSegmentIdxRef.current = 0;
    transcriptsBySegmentRef.current.clear();
    transcriptionJobsRef.current = [];
    pendingSegmentBlobsRef.current.clear();
    clearRetryTimer();
    retryAttemptRef.current = 0;
    finishingSessionRef.current = false;
    onVoiceErrorRef.current(null);
    onVoiceRecordingReadyRef.current?.(null);
    setTranscriptionPending(false);
    onTranscriptionPendingChangeRef.current?.(false);
  }, [resetRevision, stopTracks, clearCountdownTimer, clearSegmentTimer, clearRetryTimer]);

  const finishRecordingPipeline = useCallback(async () => {
    if (finishingSessionRef.current) return;
    for (let i = 0; i < 50 && rotateBusyRef.current; i += 1) {
      await new Promise((r) => setTimeout(r, 60));
    }

    finishingSessionRef.current = true;
    setRecordingState("processing");

    clearCountdownTimer();
    clearSegmentTimer();
    rotateBusyRef.current = true;
    try {
      await finalizeCurrentSegment(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Could not finish voice capture.";
      onVoiceError(msg);
      await stopArchiveRecorderAsync(false);
      stopTracks();
      setRecordingState("idle");
      finishingSessionRef.current = false;
      return;
    } finally {
      rotateBusyRef.current = false;
    }

    try {
      await Promise.all(transcriptionJobsRef.current);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === "string" ? err : "Transcription failed.";
      onVoiceError(msg);
      setRecordingState("idle");
      finishingSessionRef.current = false;
      return;
    }

    const hasPending = pendingSegmentBlobsRef.current.size > 0;
    const merged = mergeSegments(transcriptsBySegmentRef.current);
    const cleanedTranscript = merged.trim();
    setLocalTranscript(
      cleanedTranscript ||
        (hasPending ? "Still finishing transcription…" : "(No speech detected.)")
    );

    let rating = 3;
    if (!skipRatingInference && !hasPending && cleanedTranscript) {
      try {
        const inferred = await inferVoiceRatingFromTranscript(cleanedTranscript);
        if (Number.isFinite(inferred.rating)) {
          rating = Math.min(5, Math.max(1, Math.round(inferred.rating)));
        }
      } catch {
        rating = 3;
      }
    }
    lastRatingRef.current = rating;

    // The full recording is already captured (archive blob went out via
    // onVoiceRecordingReady before this point) — persist whatever transcript we
    // have now so nothing is lost, even if some segments are still offline.
    onVoiceSuccess(cleanedTranscript || (hasPending ? "" : "(No speech detected.)"), rating);
    setTranscriptionPending(hasPending);
    onTranscriptionPendingChangeRef.current?.(hasPending);
    onVoiceError(
      hasPending
        ? "Part of your recording is saved and still finishing transcription — this will complete automatically in a moment."
        : null
    );
    setRecordingState("completed");
    setSegmentsDoneUi(0);
    finishingSessionRef.current = false;
  }, [finalizeCurrentSegment, clearCountdownTimer, clearSegmentTimer, onVoiceError, onVoiceSuccess, skipRatingInference, stopArchiveRecorderAsync, stopTracks]);

  finishRecordingPipelineRef.current = () => {
    void finishRecordingPipeline();
  };

  const startRecording = async () => {
    if (!identityReady) {
      onVoiceError("Please enter your name and select your department to speak.");
      return;
    }

    onVoiceError(null);
    onVoiceCleared();
    onVoiceRecordingReadyRef.current?.(null);
    setTranscriptionPending(false);
    onTranscriptionPendingChangeRef.current?.(false);
    setLocalTranscript("");
    setLiveTranscript("");
    nextSegmentIdxRef.current = 0;
    transcriptsBySegmentRef.current.clear();
    transcriptionJobsRef.current = [];
    pendingSegmentBlobsRef.current.clear();
    clearRetryTimer();
    retryAttemptRef.current = 0;
    setSegmentsDoneUi(0);
    finishingSessionRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onVoiceError("Microphone access was denied. Allow the mic and try again.");
      return;
    }

    streamRef.current = stream;

    archiveChunksRef.current = [];
    const arcMime = pickRecorderMime();
    archiveMimeRef.current = arcMime || "audio/webm";
    try {
      const arcRec = arcMime ? new MediaRecorder(stream, { mimeType: arcMime }) : new MediaRecorder(stream);
      archiveRecorderRef.current = arcRec;
      arcRec.ondataavailable = (e) => {
        if (e.data.size > 0) archiveChunksRef.current.push(e.data);
      };
      arcRec.start(250);
    } catch {
      archiveRecorderRef.current = null;
    }

    createAndStartRecorder(stream);
    if (!mediaRecorderRef.current) {
      await stopArchiveRecorderAsync(false);
      stopTracks();
      onVoiceError("This browser cannot capture voice for upload.");
      return;
    }

    setRecordingState("recording");
    recordingStateRef.current = "recording";
    startCountdown();
    scheduleSegmentRotate();
  };

  const toggleRecording = () => {
    if (recordingState === "idle" || recordingState === "completed") {
      void startRecording();
      return;
    }
    if (recordingState === "recording") {
      void finishRecordingPipeline();
    }
  };

  const identityMissing = !identityReady;
  const micDisabled =
    recordingState === "processing" || (recordingState === "recording" ? false : identityMissing);

  const micIsPrimary = recordingState === "idle" && !identityMissing;

  const recordAgain = () => {
    clearCountdownTimer();
    clearSegmentTimer();
    setSecondsRemaining(maxRecordingSeconds);
    setRecordingState("idle");
    setLocalTranscript("");
    setLiveTranscript("");
    setSegmentsDoneUi(0);
    onVoiceCleared();
    onVoiceError(null);
    onVoiceRecordingReadyRef.current?.(null);
    setTranscriptionPending(false);
    onTranscriptionPendingChangeRef.current?.(false);
    nextSegmentIdxRef.current = 0;
    transcriptsBySegmentRef.current.clear();
    transcriptionJobsRef.current = [];
    pendingSegmentBlobsRef.current.clear();
    clearRetryTimer();
    retryAttemptRef.current = 0;
    finishingSessionRef.current = false;
  };

  const displayTranscript =
    localTranscript.trim() ||
    liveTranscript.trim() ||
    (recordingState === "processing" ? "Understanding your feedback…" : "");

  const showTranscriptPanel =
    recordingState === "processing" ||
    recordingState === "completed" ||
    (recordingState === "recording" && Boolean(liveTranscript.trim()));

  return (
    <div className={isStaffRemarks ? "mb-2" : "mb-6"}>
      <div className={`flex flex-col items-center ${isStaffRemarks ? "gap-4 mb-4" : "gap-6 mb-6"}`}>
        <div className="w-full max-w-xs">
          <label className="mb-1.5 block text-center text-sm font-medium text-gray-700">
            Speech language
          </label>
          <select
            value={speechLanguageCode}
            onChange={(e) => setSpeechLanguageCode(e.target.value as SpeechLanguageCode)}
            disabled={recordingState === "recording" || recordingState === "processing"}
            className="h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none transition hover:border-gray-400 focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
          >
            <option value="unknown">Auto detect</option>
            <option value="en-IN">English</option>
            <option value="hi-IN">Hindi</option>
            <option value="ta-IN">Tamil</option>
            <option value="te-IN">Telugu</option>
            <option value="kn-IN">Kannada</option>
          </select>
        </div>

        <div className="text-center min-h-[56px]">
          <p className={`font-semibold tracking-tight text-gray-900 mb-1 ${isStaffRemarks ? "text-base" : "text-lg md:text-xl"}`}>
            {recordingState === "idle" && (isStaffRemarks ? "Tap to record staff note" : "We're ready to listen")}
            {recordingState === "recording" && (isStaffRemarks ? "Recording staff note…" : "We're listening…")}
            {recordingState === "processing" && "One moment…"}
            {recordingState === "completed" && "Done"}
          </p>
          {recordingState === "idle" && !identityMissing && (
            <p className="text-sm text-gray-500 mt-1">
              Up to {formatCountdown(maxRecordingSeconds)} to speak
            </p>
          )}
          {recordingState === "recording" && (
            <>
              <p className="text-sm text-gray-600">
                Take your time — tap <span className="font-semibold text-gray-800">Done</span> when you
                finish speaking.
              </p>
              {segmentsDoneUi > 0 && liveTranscript.trim() && (
                <p className="mt-3 text-sm text-gray-700 leading-relaxed px-2">
                  {liveTranscript.trim()}
                </p>
              )}
              {segmentsDoneUi > 0 && !liveTranscript.trim() && (
                <p className="mt-2 text-xs font-medium" style={{ color: primaryColor }}>
                  {segmentsDoneUi} part{segmentsDoneUi === 1 ? "" : "s"} sent for transcription…
                </p>
              )}
            </>
          )}
        </div>

        {recordingState === "recording" && (
          <>
            <div
              className="flex items-end justify-center gap-1 h-16 w-full max-w-xs"
              aria-hidden
            >
              {Array.from({ length: 24 }, (_, i) => (
                <div
                  key={i}
                  className="w-1.5 rounded-full animate-pulse"
                  style={{
                    backgroundColor: primaryColor,
                    height: `${10 + (i % 5) * 8}px`,
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
            <div className="w-full max-w-sm space-y-2 text-center">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                role="progressbar"
                aria-valuenow={secondsRemaining}
                aria-valuemin={0}
                aria-valuemax={maxRecordingSeconds}
                aria-label="Listening time available"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-linear"
                  style={{
                    width: `${Math.max(0, (secondsRemaining / maxRecordingSeconds) * 100)}%`,
                    backgroundColor: primaryColor,
                  }}
                />
              </div>
              <p className="text-xs text-gray-400">
                Up to {formatCountdown(maxRecordingSeconds)} per recording
              </p>
            </div>
          </>
        )}

        <div className="w-full max-w-md">
          {recordingState === "processing" ? (
            <div className="flex items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-6 py-4 text-gray-600">
              <Loader size={20} className="animate-spin shrink-0" />
              <span className="text-sm font-medium">
                {isStaffRemarks ? "Transcribing staff note…" : "Understanding your feedback…"}
              </span>
            </div>
          ) : recordingState === "recording" ? (
            <button
              type="button"
              onClick={toggleRecording}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold text-white shadow-[0_8px_20px_-8px_rgb(74_13_31/0.45)] transition-all hover:brightness-110 active:translate-y-px"
              style={{ backgroundColor: primaryColor }}
            >
              <Check size={18} strokeWidth={2.5} />
              Done speaking
            </button>
          ) : isStaffRemarks ? (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={micDisabled || recordingState === "completed"}
              title={identityMissing ? "Please enter your name and select your department to speak" : undefined}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-all ${
                micDisabled || recordingState === "completed"
                  ? "border border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "text-white hover:brightness-110 active:translate-y-px"
              }`}
              style={micIsPrimary ? { backgroundColor: primaryColor } : undefined}
            >
              <AudioLines size={20} strokeWidth={2} />
              {recordingState === "completed" ? "Note recorded" : "Record staff note"}
            </button>
          ) : (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={micDisabled || recordingState === "completed"}
              title={identityMissing ? "Please enter your name and select your department to speak" : undefined}
              className={`group mx-auto flex flex-col items-center gap-3 outline-none ${
                micDisabled || recordingState === "completed" ? "cursor-not-allowed" : ""
              }`}
            >
              <span
                className={`relative grid h-24 w-24 place-items-center rounded-full transition-all duration-200 group-focus-visible:ring-4 group-focus-visible:ring-primary/25 group-focus-visible:ring-offset-2 ${
                  micIsPrimary
                    ? "text-white shadow-[0_14px_30px_-10px_rgb(74_13_31/0.55)] group-hover:scale-105 group-active:scale-100"
                    : recordingState === "completed"
                      ? "border border-gray-200 bg-white text-gray-500"
                      : "border border-gray-200 bg-gray-100 text-gray-400"
                }`}
                style={micIsPrimary ? { backgroundColor: primaryColor } : undefined}
              >
                {micIsPrimary ? (
                  <span
                    aria-hidden
                    className="absolute -inset-2 rounded-full border opacity-60"
                    style={{ borderColor: `${primaryColor}40` }}
                  />
                ) : null}
                {recordingState === "completed" ? (
                  <Check size={34} strokeWidth={2.25} />
                ) : (
                  <AudioLines size={34} strokeWidth={2} />
                )}
              </span>
              <span
                className={`text-base font-semibold ${micIsPrimary ? "text-gray-900" : "text-gray-500"}`}
              >
                {recordingState === "completed" ? "Feedback received" : "Share your experience"}
              </span>
            </button>
          )}
        </div>
      </div>

      {(displayTranscript || recordingState === "completed" || recordingState === "processing") && (
        <div className="animate-in fade-in slide-in-from-bottom duration-300">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
            {isStaffRemarks ? "Staff remark transcript" : "What we heard"}
          </p>
          <div className="mb-4 min-h-[96px] rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
            <p className="text-base leading-relaxed text-gray-800">{displayTranscript}</p>
          </div>
          {transcriptionPending && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <Loader size={16} className="animate-spin shrink-0" />
              Your recording is saved on this device and is still finishing transcription — this
              will complete automatically.
            </div>
          )}
          {recordingState === "completed" && (
            <p className="text-center">
              <button
                type="button"
                onClick={recordAgain}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition hover:bg-gray-50"
                style={{ color: primaryColor }}
              >
                <RotateCcw size={15} />
                Speak again
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
