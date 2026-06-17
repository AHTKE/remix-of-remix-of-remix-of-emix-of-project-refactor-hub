import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { getMySupport, sendSupportMessage } from "@/lib/student.functions";

export const Route = createFileRoute("/student/support")({
  component: SupportPage,
});

function SupportPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["support"],
    queryFn: () => getMySupport(),
    refetchInterval: 8000,
  });
  const send = useServerFn(sendSupportMessage);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [q.data?.messages.length]);

  const m = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (text.trim()) fd.set("text", text.trim());
      if (file) fd.set("file", file);
      return send({ data: fd });
    },
    onSuccess: () => {
      setText(""); setFile(null);
      qc.invalidateQueries({ queryKey: ["support"] });
    },
  });

  return (
    <div className="max-w-3xl mx-auto h-[calc(100vh-3.5rem)] md:h-screen flex flex-col">
      <header className="px-5 md:px-8 py-4 border-b border-border bg-card/40 backdrop-blur-xl">
        <h1 className="font-bold text-lg">🆘 الدعم الفني</h1>
        <p className="text-xs text-muted-foreground">المحادثة تظل مفتوحة دائمًا. اكتب وقتما تشاء.</p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 md:px-8 py-5 space-y-3">
        {q.isLoading ? (
          <div className="text-center text-muted-foreground">جاري التحميل...</div>
        ) : !q.data?.messages.length ? (
          <div className="text-center text-muted-foreground mt-10">
            👋 ابدأ المحادثة بأي رسالة. فريق الدعم هيرد عليك في أقرب وقت.
          </div>
        ) : (
          q.data.messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "student"
                  ? "brand-gradient text-primary-foreground mr-auto rounded-bl-sm"
                  : "bg-secondary mr-0 ml-auto rounded-br-sm"
              }`}
            >
              {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
              {m.file_id && m.file_kind === "photo" && (
                <img src={`/api/public/media/${m.file_id}`} className="mt-2 rounded-lg max-h-60" alt="" />
              )}
              {m.file_id && m.file_kind === "document" && (
                <a href={`/api/public/media/${m.file_id}`} target="_blank" rel="noreferrer" className="block mt-2 underline">📎 فتح الملف</a>
              )}
              <div className="text-[10px] opacity-70 mt-1">
                {new Date(m.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3 md:p-4 bg-card/60 backdrop-blur-xl">
        <div className="flex items-end gap-2">
          <label className="cursor-pointer rounded-lg bg-secondary/60 hover:bg-secondary px-3 py-2.5 text-lg">
            📎
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="اكتب رسالتك..."
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if ((text.trim() || file) && !m.isPending) m.mutate();
              }
            }}
            className="flex-1 resize-none rounded-xl bg-input border border-border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => m.mutate()}
            disabled={m.isPending || (!text.trim() && !file)}
            className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold disabled:opacity-50"
          >
            ➤
          </button>
        </div>
        {file && (
          <div className="mt-2 text-xs text-muted-foreground">📎 {file.name} <button onClick={() => setFile(null)} className="text-destructive ml-2">إزالة</button></div>
        )}
      </div>
    </div>
  );
}
