import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCourses, listLessons, listQuizzesAdmin, saveQuizAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/quizzes")({ component: QuizzesPage });

function QuizzesPage() {
  const qc = useQueryClient();
  const quizzes = useQuery({ queryKey: ["quizzes"], queryFn: useServerFn(listQuizzesAdmin) });
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });
  const listLessonsFn = useServerFn(listLessons);
  const lessons = useQuery({ queryKey: ["all-lessons"], queryFn: () => listLessonsFn({ data: {} }) });
  const save = useServerFn(saveQuizAdmin);
  const [title, setTitle] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [duration, setDuration] = useState(20);
  const [questionText, setQuestionText] = useState("");
  const [options, setOptions] = useState("اختيار 1\nاختيار 2\nاختيار 3\nاختيار 4");
  const [correct, setCorrect] = useState(0);
  const [explanation, setExplanation] = useState("");

  async function createQuiz() {
    const opts = options.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6);
    if (!title.trim() || !questionText.trim() || opts.length < 2) return alert("أدخل عنوان الامتحان وسؤالًا واختيارين على الأقل");
    const lesson = lessons.data?.find((l) => l.id === lessonId);
    await save({ data: {
      id: "qz_" + Date.now().toString(36),
      title: title.trim(), lesson_id: lessonId || null, course_id: lesson?.course_id || null,
      duration_seconds: duration * 60, shuffle_questions: true, shuffle_options: true,
      questions: [{ id: "qq_" + Date.now().toString(36), text: questionText.trim(), options: opts, correct_index: Math.min(correct, opts.length - 1), explanation }],
    } });
    setTitle(""); setQuestionText(""); setExplanation("");
    await qc.invalidateQueries({ queryKey: ["quizzes"] });
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">محرك الامتحانات</h1><p className="text-sm text-muted-foreground mt-1">MCQ بسؤال-بسؤال، خلط تلقائي، Timer، وتصحيح فوري داخل البوت.</p></div>
      <section className="surface-card p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="عنوان الامتحان"><input value={title} onChange={(e) => setTitle(e.target.value)} className="input-dark" /></Field>
          <Field label="ربط بالحصة"><select value={lessonId} onChange={(e) => setLessonId(e.target.value)} className="input-dark"><option value="">بدون ربط</option>{(lessons.data ?? []).map((l) => <option key={l.id} value={l.id}>{courses.data?.find((c) => c.id === l.course_id)?.title} / {l.title}</option>)}</select></Field>
          <Field label="المدة بالدقائق"><input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input-dark" /></Field>
        </div>
        <Field label="نص السؤال"><textarea rows={3} value={questionText} onChange={(e) => setQuestionText(e.target.value)} className="input-dark" /></Field>
        <div className="grid md:grid-cols-[1fr_160px] gap-3">
          <Field label="الاختيارات — كل اختيار في سطر"><textarea rows={5} value={options} onChange={(e) => setOptions(e.target.value)} className="input-dark" /></Field>
          <Field label="رقم الإجابة الصحيحة"><input type="number" min={1} max={6} value={correct + 1} onChange={(e) => setCorrect(Math.max(0, Number(e.target.value) - 1))} className="input-dark" /></Field>
        </div>
        <Field label="شرح فكرة الحل"><textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} className="input-dark" /></Field>
        <button onClick={createQuiz} className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring">إنشاء الامتحان</button>
      </section>
      <section className="grid md:grid-cols-2 gap-4">
        {(quizzes.data ?? []).map((q) => <div key={q.id} className="surface-card p-5"><div className="font-semibold">{q.title}</div><div className="mt-2 text-xs text-muted-foreground">{q.questions.length} سؤال · {Math.round(q.duration_seconds / 60)} دقيقة · خلط الأسئلة والاختيارات مفعّل</div></div>)}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="text-xs text-muted-foreground mb-1 block">{label}</span>{children}</label>; }