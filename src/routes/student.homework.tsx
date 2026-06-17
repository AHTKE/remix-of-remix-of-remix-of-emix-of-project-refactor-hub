import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listMyHomework, submitHomework } from "@/lib/student.functions";

export const Route = createFileRoute("/student/homework")({
  component: HomeworkPage,
});

function HomeworkPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["my-homework"], queryFn: () => listMyHomework() });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold">📝 الواجبات</h1>
        <p className="text-sm text-muted-foreground mt-1">واجبات الكورسات المفعّلة</p>
      </header>

      {q.isLoading ? (
        <div className="surface-card h-40 animate-pulse" />
      ) : !q.data?.length ? (
        <div className="surface-card p-12 text-center text-muted-foreground">لا توجد واجبات حاليًا.</div>
      ) : (
        <div className="space-y-3">
          {q.data.map((h) => (
            <article key={h.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">{h.title}</h3>
                  <div className="text-xs text-muted-foreground mt-1">
                    {h.course_title} {h.lesson_title && `• ${h.lesson_title}`}
                  </div>
                  {h.due_at && (
                    <div className="text-xs text-muted-foreground mt-1">
                      ⏰ آخر موعد: <span className={new Date(h.due_at).getTime() < Date.now() ? "text-destructive" : ""}>{new Date(h.due_at).toLocaleString("ar-EG")}</span>
                    </div>
                  )}
                </div>
                <div className="text-xs">
                  {h.last_submission?.graded_at ? (
                    <span className="px-2 py-1 rounded-full bg-primary/15 text-primary font-bold">
                      ✅ {h.last_submission.score}/{h.max_score}
                    </span>
                  ) : h.last_submission ? (
                    <span className="px-2 py-1 rounded-full bg-muted text-muted-foreground">⏳ بانتظار التصحيح</span>
                  ) : (
                    <span className="px-2 py-1 rounded-full bg-secondary">📤 لم يُسلّم</span>
                  )}
                </div>
              </div>
              <p className="text-sm mt-3 whitespace-pre-wrap">{h.instructions}</p>
              {h.last_submission?.feedback && (
                <div className="mt-3 text-sm rounded-md bg-secondary/40 px-3 py-2">
                  <div className="text-xs font-semibold mb-1">ملاحظات المعلم:</div>
                  {h.last_submission.feedback}
                </div>
              )}
              <div className="mt-3">
                {openId === h.id ? (
                  <SubmitForm
                    hwId={h.id}
                    onClose={() => setOpenId(null)}
                    onDone={() => {
                      setOpenId(null);
                      qc.invalidateQueries({ queryKey: ["my-homework"] });
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setOpenId(h.id)}
                    className="rounded-lg border border-border bg-secondary/60 px-4 py-2 text-sm font-medium hover:bg-secondary"
                  >
                    📤 {h.last_submission ? "إعادة التسليم" : "تسليم الواجب"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function SubmitForm({ hwId, onClose, onDone }: { hwId: string; onClose: () => void; onDone: () => void }) {
  const submit = useServerFn(submitHomework);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set("homework_id", hwId);
      if (text.trim()) fd.set("text", text.trim());
      if (file) fd.set("file", file);
      return submit({ data: fd });
    },
    onSuccess: () => onDone(),
    onError: (e: any) => setErr(e.message || "خطأ"),
  });
  return (
    <div className="mt-2 space-y-2 border-t border-border pt-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="اكتب إجابتك..."
        className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <label className="block rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-sm cursor-pointer">
        <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" />
        📎 {file ? file.name : "أرفق ملف (اختياري)"}
      </label>
      {err && <div className="text-sm text-destructive bg-destructive/10 rounded px-2 py-1">{err}</div>}
      <div className="flex gap-2">
        <button onClick={() => m.mutate()} disabled={m.isPending} className="flex-1 rounded-lg brand-gradient text-primary-foreground py-2 text-sm font-semibold disabled:opacity-50">
          {m.isPending ? "..." : "إرسال"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">إلغاء</button>
      </div>
    </div>
  );
}
