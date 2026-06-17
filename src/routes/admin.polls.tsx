import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCourses, listPollsAdmin, savePollAdmin, sendPollAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/polls")({ component: PollsPage });

function PollsPage() {
  const qc = useQueryClient();
  const polls = useQuery({ queryKey: ["polls"], queryFn: useServerFn(listPollsAdmin) });
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });
  const save = useServerFn(savePollAdmin);
  const send = useServerFn(sendPollAdmin);
  const [question, setQuestion] = useState("");
  const [type, setType] = useState<"choice" | "rating" | "feedback">("choice");
  const [courseId, setCourseId] = useState<string>("");
  const [options, setOptions] = useState("ممتاز\nمتوسط\nضعيف");
  const [busy, setBusy] = useState(false);

  async function createPoll(sendNow = false) {
    const opts = options.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);
    if (!question.trim() || opts.length < 2) return alert("اكتب السؤال واختيارين على الأقل");
    setBusy(true);
    try {
      const res = await save({ data: { id: "p_" + Date.now().toString(36), question: question.trim(), options: opts, type, target_course_id: courseId || null, is_open: true } });
      if (sendNow) await send({ data: { poll_id: res.poll.id } });
      setQuestion("");
      await qc.invalidateQueries({ queryKey: ["polls"] });
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">منشئ التصويتات</h1>
        <p className="text-sm text-muted-foreground mt-1">استطلاعات تفاعلية تُرسل للطلاب وتعرض نسبًا مباشرة.</p>
      </div>

      <section className="surface-card p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="نوع التصويت">
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="input-dark">
              <option value="choice">متعدد الخيارات</option>
              <option value="rating">تقييم</option>
              <option value="feedback">سؤال رأي</option>
            </select>
          </Field>
          <Field label="كورس مستهدف (اختياري)">
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className="input-dark">
              <option value="">كل الطلاب</option>
              {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <button disabled={busy} onClick={() => createPoll(false)} className="rounded-xl bg-secondary px-4 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50">حفظ</button>
            <button disabled={busy} onClick={() => createPoll(true)} className="rounded-xl brand-gradient text-primary-foreground px-4 py-2.5 text-sm font-semibold glow-ring disabled:opacity-50">حفظ وإرسال</button>
          </div>
        </div>
        <Field label="السؤال">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="ما رأيك في مستوى الحصة؟" className="input-dark" />
        </Field>
        <Field label="الاختيارات — كل اختيار في سطر">
          <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={5} className="input-dark" />
        </Field>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {(polls.data ?? []).map((poll) => (
          <div key={poll.id} className="surface-card p-5 space-y-4">
            <div className="flex justify-between gap-3">
              <div>
                <div className="font-semibold">{poll.question}</div>
                <div className="text-xs text-muted-foreground mt-1">{poll.analytics.total} مصوّت · أُرسل {poll.sent_message_count || 0}</div>
              </div>
              <button onClick={async () => { await send({ data: { poll_id: poll.id } }); qc.invalidateQueries({ queryKey: ["polls"] }); }} className="text-xs rounded-lg bg-primary/15 text-primary px-3 py-1.5">إرسال</button>
            </div>
            <div className="space-y-2">
              {poll.options.map((opt, i) => (
                <div key={opt}>
                  <div className="flex justify-between text-xs mb-1"><span>{opt}</span><span>{poll.analytics.percentages[i]}% · {poll.analytics.counts[i]}</span></div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full brand-gradient" style={{ width: `${poll.analytics.percentages[i]}%` }} /></div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-muted-foreground mb-1 block">{label}</span>{children}</label>;
}