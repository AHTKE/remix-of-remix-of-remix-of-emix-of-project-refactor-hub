import { useRouter } from "@tanstack/react-router";

export function BackButton({
  fallback = "/",
  label = "رجوع",
  className = "",
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: fallback });
    }
  }

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-xl border border-border bg-secondary/60 backdrop-blur px-3 py-2 text-sm font-medium hover:bg-secondary transition ${className}`}
    >
      <span>←</span>
      <span>{label}</span>
    </button>
  );
}
