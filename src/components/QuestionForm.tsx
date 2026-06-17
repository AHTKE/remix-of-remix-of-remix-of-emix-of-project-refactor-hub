import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { saveQuestion, uploadMedia } from "@/lib/admin.functions";
import type { Question, MediaItem } from "@/lib/types";

type Props = {
  initial: Question;
  allQuestions: Question[];
};

export function QuestionForm({ initial, allQuestions }: Props) {
  const saveFn = useServerFn(saveQuestion);
  const uploadFn = useServerFn(uploadMedia);
  const navigate = useNavigate();
  const [q, setQ] = useState<Question>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "photo" | "video") {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const newMedia: MediaItem[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("kind", kind);
        const res = await uploadFn({ data: fd });
        newMedia.push({ type: kind, file_id: res.file_id });
      }
      setQ({ ...q, media: [...q.media, ...newMedia] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function removeMedia(i: number) {
    setQ({ ...q, media: q.media.filter((_, idx) => idx !== i) });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveFn({ data: q });
      navigate({ to: "/admin" });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const possibleParents = allQuestions.filter(
    (p) => p.id !== q.id && !p.parent_id
  );

  return (
    <div className="surface-card p-6 space-y-5 max-w-3xl">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          عنوان الزر <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          value={q.title}
          onChange={(e) => setQ({ ...q, title: e.target.value })}
          maxLength={60}
          required
          className="input-dark"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          نص الإجابة (يدعم HTML: &lt;b&gt;، &lt;i&gt;، &lt;a&gt;)
        </label>
        <textarea
          value={q.answer}
          onChange={(e) => setQ({ ...q, answer: e.target.value })}
          rows={6}
          maxLength={3500}
          className="input-dark font-mono text-sm"
        />
        <div className="text-xs text-muted-foreground mt-1">{q.answer.length} / 3500</div>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">القسم الأب (اختياري)</label>
        <select
          value={q.parent_id || ""}
          onChange={(e) => setQ({ ...q, parent_id: e.target.value || null })}
          className="input-dark"
        >
          <option value="">— قسم رئيسي —</option>
          {possibleParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">الترتيب</label>
        <input
          type="number"
          value={q.order}
          onChange={(e) => setQ({ ...q, order: Number(e.target.value) })}
          className="input-dark w-32"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-2">الصور والفيديوهات</label>
        <div className="flex gap-2 mb-3">
          <label className="cursor-pointer rounded-lg bg-secondary hover:bg-accent px-3 py-2 text-sm">
            📷 إضافة صور
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(e, "photo")} />
          </label>
          <label className="cursor-pointer rounded-lg bg-secondary hover:bg-accent px-3 py-2 text-sm">
            🎬 إضافة فيديو
            <input type="file" accept="video/*" multiple className="hidden" onChange={(e) => handleUpload(e, "video")} />
          </label>
          {uploading && <span className="text-sm text-primary self-center">جاري الرفع...</span>}
        </div>
        {q.media.length > 0 && (
          <div className="space-y-1.5">
            {q.media.map((m, i) => (
              <div key={i} className="flex items-center justify-between bg-secondary/40 rounded px-3 py-1.5 text-sm">
                <span className="font-mono text-xs text-muted-foreground truncate">
                  {m.type === "photo" ? "📷" : "🎬"} {m.file_id.slice(0, 40)}...
                </span>
                <button onClick={() => removeMedia(i)} className="text-destructive text-xs hover:underline">حذف</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-destructive bg-destructive/10 rounded p-3">{error}</div>}

      <div className="flex gap-2 pt-2">
        <button
          onClick={save}
          disabled={busy || !q.title}
          className="rounded-lg brand-gradient text-primary-foreground px-5 py-2 font-medium disabled:opacity-50"
        >
          {busy ? "حفظ..." : "حفظ"}
        </button>
        <button
          onClick={() => navigate({ to: "/admin" })}
          className="rounded-lg border border-border px-5 py-2 hover:bg-secondary"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
