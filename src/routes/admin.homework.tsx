import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteHomeworkAdmin,
  gradeSubmissionAdmin,
  listCourses,
  listHomeworkAdmin,
  listLessons,
  listSubmissionsAdmin,
  saveHomeworkAdmin,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/homework")({ component: HomeworkPage });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-muted-foreground mb-1 block">{label}</span>{children}</label>;
}

function HomeworkPage() {
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });
  const listLessonsFn = useServerFn(listLessons);
  const lessons = useQuery({ queryKey: ["all-lessons"], queryFn: () => listLessonsFn({ data: {} }) });
  const homework = useQuery({ queryKey: ["homework"], queryFn: useServerFn(listHomeworkAdmin) });
  const save = useServerFn(saveHomeworkAdmin);
  const del = useServerFn(deleteHomeworkAdmin);

  const [title, setTitle] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [maxScore, setMaxScore] = useState(100);
  const [viewing, setViewing] = useState<string | null>(null);

  async function create() {
    const lesson = lessons.data?.find((l) => l.id === lessonId);
    if (!title.trim() || !lesson) return alert("أدخل عنوان الواجب واختر الحصة");
    await save({ data: {
      id: "hw_" + Date.now().toString(36),
      title: title.trim(), lesson_id: lessonId, course_id: lesson.course_id,
      instructions: instructions.trim(), max_score: maxScore, due_at: null,
    } });
    setTitle(""); setInstructions("");
    await qc.invalidateQueries({ queryKey: ["homework"] });
  }

  async function remove(id: string) {
    if (!confirm("حذف هذا الواجب؟")) return;
    await del({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["homework"] });
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">الواجبات</h1><p className="text-sm text-muted-foreground mt-1">أنشئ الواجبات وصحّح تسليمات الطلاب فورًا.</p></div>

      <section className="surface-card p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="عنوان الواجب"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input-dark" /></Field>
          <Field label="الحصة"><select value={lessonId} onChange={(e) => setLessonId(e.target.value)} className="input-dark"><option value="">اختر الحصة</option>{(lessons.data ?? []).map((l) => <option key={l.id} value={l.id}>{courses.data?.find((c) => c.id === l.course_id)?.title} / {l.title}</option>)}</select></Field>
          <Field label="الدرجة العظمى"><input type="number" min={1} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} className="input-dark" /></Field>
        </div>
        <Field label="التعليمات"><textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} className="input-dark" /></Field>
        <button onClick={create} className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring">إنشاء الواجب</button>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {(homework.data ?? []).map((h) => (
          <div key={h.id} className="surface-card p-5 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold">{h.title}</div>
              <button onClick={() => remove(h.id)} className="text-xs text-destructive hover:underline">حذف</button>
            </div>
            <div className="text-xs text-muted-foreground">{h.course_title} / {h.lesson_title} · الدرجة {h.max_score}</div>
            <div className="text-xs text-muted-foreground">{h.submissions_count} تسليم · {h.graded_count} مُصحّح</div>
            <button onClick={() => setViewing(viewing === h.id ? null : h.id)} className="text-sm text-primary hover:underline">{viewing === h.id ? "إخفاء التسليمات" : "عرض التسليمات"}</button>
            {viewing === h.id && <Submissions homeworkId={h.id} maxScore={h.max_score} />}
          </div>
        ))}
        {homework.data?.length === 0 && <div className="text-muted-foreground text-sm">لا توجد واجبات بعد.</div>}
      </section>
    </div>
  );
}

function Submissions({ homeworkId, maxScore }: { homeworkId: string; maxScore: number }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSubmissionsAdmin);
  const subs = useQuery({ queryKey: ["submissions", homeworkId], queryFn: () => listFn({ data: { homework_id: homeworkId } }) });
  const grade = useServerFn(gradeSubmissionAdmin);

  async function doGrade(id: string, score: number, feedback: string) {
    await grade({ data: { id, score, feedback } });
    await qc.invalidateQueries({ queryKey: ["submissions", homeworkId] });
    await qc.invalidateQueries({ queryKey: ["homework"] });
  }

  return (
    <div className="mt-2 space-y-3 border-t border-border pt-3">
      {(subs.data ?? []).map((s) => <SubmissionRow key={s.id} sub={s} maxScore={maxScore} onGrade={doGrade} />)}
      {subs.data?.length === 0 && <div className="text-xs text-muted-foreground">لا توجد تسليمات.</div>}
    </div>
  );
}

function SubmissionRow({ sub, maxScore, onGrade }: { sub: any; maxScore: number; onGrade: (id: string, score: number, feedback: string) => void }) {
  const [score, setScore] = useState<number>(sub.score ?? 0);
  const [feedback, setFeedback] = useState<string>(sub.feedback ?? "");
  return (
    <div className="rounded-lg bg-secondary/30 p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{sub.student_name}</span>
        {sub.graded_at ? <span className="text-xs text-green-500">مُصحّح: {sub.score}/{maxScore}</span> : <span className="text-xs text-amber-500">بانتظار التصحيح</span>}
      </div>
      {sub.text && <div className="text-muted-foreground whitespace-pre-wrap">{sub.text}</div>}
      {sub.file_id && <a href={`/api/public/media/${sub.file_id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">📎 عرض المرفق</a>}
      <div className="grid grid-cols-[100px_1fr_auto] gap-2 items-end">
        <input type="number" min={0} max={maxScore} value={score} onChange={(e) => setScore(Number(e.target.value))} className="input-dark" />
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="ملاحظة (اختياري)" className="input-dark" />
        <button onClick={() => onGrade(sub.id, score, feedback)} className="rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium">حفظ</button>
      </div>
    </div>
  );
}
