import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { closeTicketAdmin, listTicketsAdmin, replyTicketAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/support")({ component: SupportPage });

function SupportPage() {
  const qc = useQueryClient();
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: useServerFn(listTicketsAdmin) });
  const reply = useServerFn(replyTicketAdmin);
  const close = useServerFn(closeTicketAdmin);
  const [filter, setFilter] = useState<"open" | "closed" | "all">("open");

  async function send(ticketId: string, text: string) {
    await reply({ data: { ticket_id: ticketId, text } });
    await qc.invalidateQueries({ queryKey: ["tickets"] });
  }
  async function doClose(ticketId: string) {
    if (!confirm("إغلاق التذكرة؟")) return;
    await close({ data: { ticket_id: ticketId } });
    await qc.invalidateQueries({ queryKey: ["tickets"] });
  }

  const list = (tickets.data ?? []).filter((t) => (filter === "all" ? true : t.status === filter));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold">الدعم الفني</h1><p className="text-sm text-muted-foreground mt-1">رد على تذاكر الطلاب مباشرة من هنا.</p></div>
        <div className="flex gap-1 text-sm">
          {(["open", "closed", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg ${filter === f ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60"}`}>{f === "open" ? "مفتوحة" : f === "closed" ? "مغلقة" : "الكل"}</button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {list.map((t) => <Ticket key={t.id} ticket={t} onSend={send} onClose={doClose} />)}
        {list.length === 0 && <div className="surface-card p-8 text-center text-muted-foreground text-sm">لا توجد تذاكر.</div>}
      </div>
    </div>
  );
}

function Ticket({ ticket, onSend, onClose }: { ticket: any; onSend: (id: string, text: string) => void; onClose: (id: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="surface-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-semibold">{ticket.subject}</div>
          <div className="text-xs text-muted-foreground">{ticket.student_name} · {ticket.status === "open" ? <span className="text-green-500">مفتوحة</span> : <span>مغلقة</span>}</div>
        </div>
        {ticket.status === "open" && <button onClick={() => onClose(ticket.id)} className="text-xs text-destructive hover:underline">إغلاق</button>}
      </div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {ticket.messages.map((m: any) => (
          <div key={m.id} className={`rounded-lg p-2.5 text-sm ${m.author_role === "admin" ? "bg-primary/15 ml-8" : "bg-secondary/40 mr-8"}`}>
            <div className="text-[10px] text-muted-foreground mb-0.5">{m.author_role === "admin" ? "الإدارة" : "الطالب"} · {new Date(m.created_at).toLocaleString("ar-EG")}</div>
            {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
            {m.file_id && <a href={`/api/public/media/${m.file_id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">📎 مرفق</a>}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب ردك..." className="input-dark flex-1" onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onSend(ticket.id, text.trim()); setText(""); } }} />
        <button onClick={() => { if (text.trim()) { onSend(ticket.id, text.trim()); setText(""); } }} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">إرسال</button>
      </div>
    </div>
  );
}
