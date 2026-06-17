import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { getQuizForTaking, submitQuizAttempt } from "@/lib/student.functions";

export const Route = createFileRoute("/student/quizzes/$id")({
  component: TakeQuiz,
});

function TakeQuiz() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["quiz-take", id], queryFn: () => getQuizForTaking({ data: { quizId: id } }) });
  const submit = useServerFn(submitQuizAttempt);
  const startedAt = useMemo(() => new Date().toISOString(), [id]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [remaining, setRemaining] = useState<number>(0);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    if (q.data?.duration_seconds && !result) {
      setRemaining(q.data.duration_seconds);
      const iv = setInterval(() => setRemaining((r) => (r <= 1 ? 0 : r - 1)), 1000);
      return () => clearInterval(iv);
    }
  }, [q.data?.duration_seconds, result]);

  const submitMut = useMutation({
    mutationFn: async () => submit({
      data: {
        quiz_id: id,
        started_at: startedAt,
        answers: Object.entries(answers).map(([qid, chosen_index]) => ({ qid, chosen_index })),
      },
    }),
    onSuccess: (r) => setResult(r),
  });

  useEffect(() => {
    if (remaining === 0 && q.data && !result && !submitMut.isPending) {
      submitMut.mutate();
    }
  }, [remaining]);

  if (q.isLoading) return <div className="p-10 text-muted-foreground">جاري التحميل...</div>;
  if (q.error) return <div className="surface-card m-6 p-6 text-destructive">{(q.error as Error).message}</div>;
  if (!q.data) return null;

  if (result) {
    return (
      <div className="max-w-3xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-5">
        <div className="surface-card p-6 text-center brand-gradient text-primary-foreground">
          <div className="text-sm opacity-90">نتيجتك</div>
          <div className="text-5xl font-extrabold mt-2">{result.score}/{result.total}</div>
        </div>
        <div className="space-y-3">
          {result.review.map((r: any, i: number) => (
            <article key={r.id} className="surface-card p-4">
              <div className="font-semibold mb-2">{i + 1}. {r.text}</div>
              <div className="space-y-1.5 text-sm">
                {r.options.map((o: string, idx: number) => {
                  const isCorrect = idx === r.correct_index;
                  const isChosen = idx === r.chosen_index;
                  return (
                    <div
                      key={idx}
                      className={`rounded-lg px-3 py-2 border ${
                        isCorrect ? "border-primary bg-primary/10" :
                        isChosen ? "border-destructive bg-destructive/10" :
                        "border-border"
                      }`}
                    >
                      {isCorrect && "✅ "}{isChosen && !isCorrect && "❌ "}{o}
                    </div>
                  );
                })}
              </div>
              {r.explanation && <div className="text-xs text-muted-foreground mt-2">💡 {r.explanation}</div>}
            </article>
          ))}
        </div>
        <Link to="/student/quizzes" className="block text-center rounded-xl border border-border py-3 font-medium">
          → عودة للامتحانات
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-5">
      <header className="surface-card p-5 flex items-center justify-between">
        <h1 className="font-bold text-lg">{q.data.title}</h1>
        <div className={`font-mono font-bold ${remaining < 30 ? "text-destructive" : "text-primary"}`}>
          ⏱️ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
        </div>
      </header>

      <div className="space-y-3">
        {q.data.questions.map((qq, i) => (
          <article key={qq.id} className="surface-card p-5">
            <div className="font-semibold mb-3">{i + 1}. {qq.text}</div>
            {qq.image_file_id && <img src={`/api/public/media/${qq.image_file_id}`} className="rounded-lg mb-3 max-h-64" alt="" />}
            <div className="space-y-2">
              {qq.options.map((o, idx) => (
                <label
                  key={idx}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border cursor-pointer transition ${
                    answers[qq.id] === idx ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/50"
                  }`}
                >
                  <input
                    type="radio"
                    name={qq.id}
                    checked={answers[qq.id] === idx}
                    onChange={() => setAnswers((s) => ({ ...s, [qq.id]: idx }))}
                    className="accent-primary"
                  />
                  <span className="text-sm">{o}</span>
                </label>
              ))}
            </div>
          </article>
        ))}
      </div>

      <button
        onClick={() => submitMut.mutate()}
        disabled={submitMut.isPending}
        className="w-full sticky bottom-3 rounded-xl brand-gradient text-primary-foreground py-3 font-bold glow-ring disabled:opacity-50"
      >
        {submitMut.isPending ? "..." : "📤 سلّم الامتحان"}
      </button>
    </div>
  );
}
