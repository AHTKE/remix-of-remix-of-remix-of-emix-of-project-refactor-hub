import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBroadcastsAdmin, listCourses, sendBroadcastAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/broadcast")({ component: BroadcastPage });

function BroadcastPage() {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });
  const history = useQuery({ queryKey: ["broadcasts"], queryFn: useServerFn(listBroadcastsAdmin) });
  const send = useServerFn(sendBroadcastAdmin);
  const [text, setText] = useState("");
  const [courseId, setCourseId] = useState("");
  const [sending, setSending] = useState(false);

  async function doSend() {
    if (!text.trim()) return alert("اكتب نص الرسالة");
    if (!confirm("إرسال هذا الإعلان لجميع الطلاب المستهدفين؟")) return;
    setSending(true);
    try {
      const res = await send({ data: { text: text.trim(), course_id: courseId || null } });
      alert(`تم الإرسال إلى ${res.sent} طالب (${res.failed} فشل)`);
      setText("");
      await qc.invalidateQueries({ queryKey: ["broadcasts"] });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">الإعلانات الجماعية</h1><p className="text-sm text-muted-foreground mt-1">أرسل رسالة لكل الطلاب أو لطلاب كورس معيّن عبر البوت.</p></div>

      <section className="surface-card p-5 space-y-4">
        <label className="block"><span className="text-xs text-muted-foreground mb-1 block">الفئة المستهدفة</span>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="input-dark"><option value="">كل الطلاب</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>مشتركو: {c.title}</option>)}</select>
        </label>
        <label className="block"><span className="text-xs text-muted-foreground mb-1 block">نص الإعلان (يدعم HTML)</span>
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className="input-dark" placeholder="📢 إعلان هام..." />
        </label>
        <button onClick={doSend} disabled={sending} className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring disabled:opacity-50">{sending ? "جارٍ الإرسال..." : "إرسال الإعلان"}</button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">السجل</h2>
        <div className="space-y-3">
          {(history.data ?? []).map((b) => (
            <div key={b.id} className="surface-card p-4">
              <div className="text-sm whitespace-pre-wrap line-clamp-3">{b.text}</div>
              <div className="mt-2 text-xs text-muted-foreground">✅ {b.sent} · ❌ {b.failed} · {new Date(b.created_at).toLocaleString("ar-EG")}</div>
            </div>
          ))}
          {history.data?.length === 0 && <div className="text-muted-foreground text-sm">لا توجد إعلانات سابقة.</div>}
        </div>
      </section>
    </div>
  );
}
