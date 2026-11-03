import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  getAdminBotConversationConfig,
  resolveUploadUrl,
  saveAdminBotConversationConfig,
  uploadBotIntroAudio,
  uploadBotQuestionAudio,
  type BotConversationConfig,
  type BotConversationQuestion,
} from "../lib/api";
import { employeeRoutes } from "../lib/employeeRoutes";

const MAX_QUESTIONS = 30;

type DraftQuestion = BotConversationQuestion & { draftId: string };

function audioRelPathFromUploadUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.split("?")[0];
  const marker = "/uploads/";
  const i = clean.indexOf(marker);
  if (i >= 0) return clean.slice(i + marker.length);
  return null;
}

function toDraftQuestions(questions: BotConversationQuestion[]): DraftQuestion[] {
  return [...questions]
    .sort((a, b) => a.order - b.order)
    .map((q, idx) => ({
      ...q,
      order: idx,
      draftId: `loaded-${idx}-${q.order}`,
    }));
}

function questionFileHint(index: number): string {
  const n = index + 1;
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}question.mp3`;
}

export function AdminBotConversationPage() {
  const [config, setConfig] = useState<BotConversationConfig | null>(null);
  const [introText, setIntroText] = useState("");
  const [draftQuestions, setDraftQuestions] = useState<DraftQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const introFileRef = useRef<HTMLInputElement>(null);
  const questionFileRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const cfg = await getAdminBotConversationConfig();
      setConfig(cfg);
      setIntroText(cfg.introText);
      setDraftQuestions(toDraftQuestions(cfg.questions));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateQuestionText(idx: number, text: string) {
    setDraftQuestions((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, textTa: text } : q))
    );
    setDirty(true);
  }

  function addQuestion() {
    if (draftQuestions.length >= MAX_QUESTIONS) {
      setError(`You can have at most ${MAX_QUESTIONS} questions.`);
      return;
    }
    setDraftQuestions((prev) => [
      ...prev,
      {
        draftId: `new-${Date.now()}`,
        order: prev.length,
        textTa: "",
        audioUrl: null,
        videoUrl: null,
      },
    ]);
    setDirty(true);
    setMessage(null);
  }

  function removeQuestion(idx: number) {
    if (draftQuestions.length <= 1) {
      setError("At least one question is required.");
      return;
    }
    if (!window.confirm(`Remove question ${idx + 1}? Save to apply on the employee bot flow.`)) {
      return;
    }
    setDraftQuestions((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((q, i) => ({ ...q, order: i }))
    );
    setDirty(true);
    setMessage(null);
  }

  async function saveAll() {
    try {
      setSaving(true);
      setMessage(null);
      setError(null);
      const updated = await saveAdminBotConversationConfig({
        introText,
        questions: draftQuestions.map((q, idx) => ({
          order: idx,
          textTa: q.textTa.trim() || `Question ${idx + 1}`,
          audioRelPath:
            audioRelPathFromUploadUrl(q.audioUrl) ||
            audioRelPathFromUploadUrl(q.videoUrl),
        })),
      });
      setConfig(updated);
      setDraftQuestions(toDraftQuestions(updated.questions));
      setDirty(false);
      setMessage("Saved intro and questions.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onIntroAudio(file: File | undefined) {
    if (!file) return;
    try {
      setUploading("intro");
      setError(null);
      const updated = await uploadBotIntroAudio(file);
      setConfig(updated);
      if (introFileRef.current) introFileRef.current.value = "";
      setMessage("Intro audio updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function onQuestionAudio(idx: number, file: File | undefined) {
    if (!file) return;
    try {
      setUploading(`q-${idx}`);
      setError(null);
      const updated = await uploadBotQuestionAudio(idx, file);
      setConfig(updated);
      const serverSorted = [...updated.questions].sort((a, b) => a.order - b.order);
      setDraftQuestions((prev) =>
        prev.map((q, i) => {
          const serverQ = serverSorted[i];
          if (!serverQ) return q;
          return {
            ...q,
            audioUrl: serverQ.audioUrl,
            videoUrl: serverQ.videoUrl,
          };
        })
      );
      const input = questionFileRefs.current.get(idx);
      if (input) input.value = "";
      setMessage(`Audio updated for question ${idx + 1}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  if (loading) {
    return <p className="p-8 text-gray-600">Loading bot conversation settings…</p>;
  }

  const cacheVer = config?.updatedAt ? new Date(config.updatedAt).getTime() : Date.now();
  const introSrc = resolveUploadUrl(config?.introAudioUrl || config?.introVideoUrl);
  const introPlayback = introSrc ? `${introSrc}?v=${cacheVer}` : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 sm:px-4 sm:py-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Bot conversation feedback</h1>
        <p className="text-sm text-gray-600 mt-1">
          Upload saved <strong>audio</strong> (MP3) for intro and each question. Files are stored in{" "}
          <code className="break-all text-xs bg-gray-100 px-1 rounded">uploads/feedback-voice/ai_voice/</code>
        </p>
        <p className="text-sm text-primary mt-2 font-medium">
          Employee link: <span className="font-mono">{employeeRoutes.bot}</span>
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
          {message}
        </p>
      ) : null}
      {dirty ? (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-100 rounded-lg p-3">
          You have unsaved text or question changes. Click <strong>Save questions</strong> so employees see them.
        </p>
      ) : null}

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 sm:p-5">
        <h2 className="font-semibold text-gray-800">Intro audio</h2>
        <label className="block text-sm font-medium text-gray-700">Welcome text (Tamil)</label>
        <textarea
          value={introText}
          onChange={(e) => {
            setIntroText(e.target.value);
            setDirty(true);
          }}
          rows={3}
          className="w-full border border-gray-200 rounded-lg p-3 text-sm"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {introPlayback ? "Replace intro audio" : "Upload intro audio"} —{" "}
            <span className="font-mono">intro.mp3</span>
          </label>
          <input
            ref={introFileRef}
            type="file"
            accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/webm,audio/*"
            disabled={uploading === "intro"}
            onChange={(e) => void onIntroAudio(e.target.files?.[0])}
            className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-brand-100"
          />
          {uploading === "intro" ? (
            <p className="text-xs text-gray-500 mt-1">Uploading…</p>
          ) : null}
          {introPlayback ? (
            <audio controls className="mt-3 w-full" src={introPlayback} />
          ) : (
            <p className="text-xs text-gray-500 mt-2">No intro audio yet.</p>
          )}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-800">Questions ({draftQuestions.length})</h2>
          <button
            type="button"
            onClick={addQuestion}
            disabled={draftQuestions.length >= MAX_QUESTIONS}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary/5 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            Add question
          </button>
        </div>

        {draftQuestions.map((q, idx) => {
          const src = resolveUploadUrl(q.audioUrl || q.videoUrl);
          const playback = src ? `${src}?v=${cacheVer}` : null;
          return (
            <div
              key={q.draftId}
              className="border border-gray-100 rounded-lg p-3 space-y-2 bg-gray-50/50 sm:p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">
                  Question {idx + 1} — file e.g.{" "}
                  <span className="font-mono">{questionFileHint(idx)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => removeQuestion(idx)}
                  disabled={draftQuestions.length <= 1}
                  title="Remove question"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
              <textarea
                value={q.textTa}
                onChange={(e) => updateQuestionText(idx, e.target.value)}
                rows={2}
                placeholder="Tamil question text…"
                className="w-full border border-gray-200 rounded-lg p-3 text-sm bg-white"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {playback ? "Replace question audio" : "Upload question audio"}
                </label>
                <input
                  ref={(el) => {
                    if (el) questionFileRefs.current.set(idx, el);
                    else questionFileRefs.current.delete(idx);
                  }}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/webm,audio/*"
                  disabled={uploading === `q-${idx}`}
                  onChange={(e) => void onQuestionAudio(idx, e.target.files?.[0])}
                  className="w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-brand-100"
                />
                {uploading === `q-${idx}` ? (
                  <p className="text-xs text-gray-500 mt-1">Uploading…</p>
                ) : null}
              </div>
              {playback ? (
                <audio controls className="w-full" src={playback} />
              ) : (
                <p className="text-xs text-gray-500">
                  No audio yet — on-screen Tamil text is shown until you upload.
                </p>
              )}
            </div>
          );
        })}
      </section>

      <button
        type="button"
        disabled={saving}
        onClick={() => void saveAll()}
        className="px-5 py-2.5 rounded-lg bg-primary text-white font-semibold disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save questions"}
      </button>
    </div>
  );
}
