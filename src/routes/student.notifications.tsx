import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { getMyNotifications, markNotificationsRead } from "@/lib/student.functions";

export const Route = createFileRoute("/student/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["my-notifications"], queryFn: () => getMyNotifications() });
  const markFn = useServerFn(markNotificationsRead);
  const markAll = useMutation({
    mutationFn: () => markFn({ data: {} }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-notifications"] });
      await qc.invalidateQueries({ queryKey: ["student-dashboard"] });
    },
  });

  // Auto-mark on view (after 1.5s) so badges clear naturally.
  useEffect(() => {
    if (list.data?.some((n) => !n.read)) {
      const t = setTimeout(() => markAll.mutate(), 1500);
      return () => clearTimeout(t);
    }
  }, [list.data]);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">🛎️ الإشعارات</h1>
          <p className="text-sm text-muted-foreground mt-1">آخر الرسائل والتحديثات</p>
        </div>
        <button
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || !list.data?.some((n) => !n.read)}
          className="px-3 py-2 rounded-lg text-xs bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          تعليم الكل مقروء
        </button>
      </header>

      {list.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-secondary/40 animate-pulse" />
          ))}
        </div>
      ) : !list.data?.length ? (
        <div className="surface-card p-10 text-center text-muted-foreground">
          <div className="text-5xl mb-3">🔕</div>
          لا توجد إشعارات بعد.
        </div>
      ) : (
        <div className="space-y-3">
          {list.data.map((n) => (
            <article
              key={n.id}
              className={`surface-card p-4 md:p-5 flex gap-3 transition ${
                n.read ? "opacity-70" : "ring-2 ring-primary/30"
              }`}
            >
              <div className="text-2xl shrink-0">{n.read ? "📨" : "🔔"}</div>
              <div className="flex-1 min-w-0">
                <p className="whitespace-pre-wrap leading-relaxed">{n.text}</p>
                <div className="text-xs text-muted-foreground mt-2">
                  {new Date(n.created_at).toLocaleString("ar-EG")}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
