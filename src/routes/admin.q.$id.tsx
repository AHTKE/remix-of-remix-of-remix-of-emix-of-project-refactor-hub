import { createFileRoute, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getData } from "@/lib/admin.functions";
import { QuestionForm } from "@/components/QuestionForm";

export const Route = createFileRoute("/admin/q/$id")({
  component: EditQuestion,
});

function EditQuestion() {
  const { id } = useParams({ from: "/admin/q/$id" });
  const fetchData = useServerFn(getData);
  const { data, isLoading } = useQuery({ queryKey: ["bot-data"], queryFn: () => fetchData() });
  if (isLoading || !data) return <div className="text-muted-foreground">جاري التحميل...</div>;
  const q = data.questions.find((x) => x.id === id);
  if (!q) return <div className="text-destructive">السؤال غير موجود</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">تعديل: {q.title}</h1>
      <QuestionForm initial={q} allQuestions={data.questions} />
    </div>
  );
}
