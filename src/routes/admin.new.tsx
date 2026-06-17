import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getData } from "@/lib/admin.functions";
import { QuestionForm } from "@/components/QuestionForm";

export const Route = createFileRoute("/admin/new")({
  component: NewQuestion,
});

function NewQuestion() {
  const fetchData = useServerFn(getData);
  const { data, isLoading } = useQuery({ queryKey: ["bot-data"], queryFn: () => fetchData() });
  if (isLoading || !data) return <div className="text-muted-foreground">جاري التحميل...</div>;
  const newId = "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const maxOrder = data.questions.reduce((m, q) => Math.max(m, q.order), 0);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">سؤال جديد</h1>
      <QuestionForm
        initial={{ id: newId, title: "", answer: "", media: [], parent_id: null, order: maxOrder + 1 }}
        allQuestions={data.questions}
      />
    </div>
  );
}
