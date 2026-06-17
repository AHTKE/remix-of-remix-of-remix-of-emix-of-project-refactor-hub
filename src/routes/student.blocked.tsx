import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/student/blocked")({
  component: BlockedPage,
});

function BlockedPage() {
  return (
    <div className="min-h-[70vh] grid place-items-center px-6">
      <div className="max-w-md w-full surface-card p-8 text-center space-y-4">
        <div className="text-6xl">🚫</div>
        <h1 className="text-2xl font-bold text-destructive">حسابك موقوف</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          تم تعليق حسابك على المنصة. للاستفسار أو تقديم اعتراض، تواصل مع الدعم الفني.
        </p>
        <Link
          to="/student/support"
          className="inline-block px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90"
        >
          💬 التواصل مع الدعم
        </Link>
      </div>
    </div>
  );
}
