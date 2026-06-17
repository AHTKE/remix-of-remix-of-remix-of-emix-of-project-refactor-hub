import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMyActivity } from "@/lib/student.functions";

export const Route = createFileRoute("/student/activity")({
  component: ActivityPage,
});

const KIND_COLOR: Record<string, string> = {
  wallet: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
  homework: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  quiz: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
  subscription: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
};

function ActivityPage() {
  const q = useQuery({ queryKey: ["my-activity"], queryFn: () => getMyActivity() });

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold">📑 سجل النشاط</h1>
        <p className="text-sm text-muted-foreground mt-1">آخر 100 حدث على حسابك</p>
      </header>

      {q.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <div className="surface-card p-10 text-center text-muted-foreground">
          <div className="text-5xl mb-3">📭</div>
          لا يوجد نشاط بعد. ابدأ كورساً أو فعّل كوداً.
        </div>
      ) : (
        <ol className="space-y-2 relative border-r-2 border-border pr-5">
          {q.data.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -right-7 top-3 h-3 w-3 rounded-full bg-primary ring-4 ring-background" />
              <div className="surface-card p-4 flex items-start gap-3">
                <div className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center text-xl ${KIND_COLOR[e.kind] || ""}`}>
                  {e.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">{e.title}</div>
                  {e.detail && <div className="text-xs text-muted-foreground mt-1">{e.detail}</div>}
                </div>
                <div className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(e.at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
