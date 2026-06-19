import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getLesson } from "@/lib/student.functions";

export const Route = createFileRoute("/student/lessons/$id")({
  component: LessonView,
});

function LessonView() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["lesson", id], queryFn: () => getLesson({ data: { lessonId: id } }) });

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-5">
      {q.data && (
        <Link to="/student/courses/$id" params={{ id: q.data.course_id }} className="text-sm text-primary hover:underline">
          → رجوع للحصص
        </Link>
      )}

      {q.isLoading ? (
        <div className="surface-card h-64 animate-pulse" />
      ) : q.error ? (
        <div className="surface-card p-6 text-destructive">{(q.error as Error).message}</div>
      ) : q.data && (
        <>
          <header>
            <h1 className="text-2xl md:text-3xl font-bold">{q.data.title}</h1>
            {q.data.description && <p className="text-muted-foreground mt-2">{q.data.description}</p>}
          </header>

          {!q.data.resources?.length ? (
            <div className="surface-card p-8 text-center text-muted-foreground">لا توجد ملفات.</div>
          ) : (
            <div className="space-y-4">
              {q.data.resources.map((r) => (
                <article key={r.id} className="surface-card p-4 md:p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <span>{iconFor(r.kind)}</span>
                    <span>{r.file_name || r.kind}</span>
                  </div>
                  {r.kind === "link" ? (
                    <div className="space-y-3">
                      {googleDrivePreview(r.url) ? (
                        <iframe
                          src={googleDrivePreview(r.url)!}
                          title={r.file_name || "شرح Google Drive"}
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          className="w-full rounded-xl bg-secondary aspect-video border border-border"
                        />
                      ) : null}
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold"
                      >
                        🔗 فتح الشرح
                      </a>
                    </div>
                  ) : r.kind === "video" ? (
                    r.url && !r.file_id ? (
                      googleDrivePreview(r.url) ? (
                        <iframe
                          src={googleDrivePreview(r.url)!}
                          title={r.file_name || "فيديو الحصة"}
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          className="w-full rounded-xl bg-black aspect-video border border-border"
                          onContextMenu={(e) => e.preventDefault()}
                        />
                      ) : (
                        <SecureVideo src={r.url} title={r.file_name || "فيديو الحصة"} />
                      )
                    ) : (
                      r.file_id ? (
                        <SecureVideo src={`/api/public/media/${encodeURIComponent(r.file_id)}`} title={r.file_name || "فيديو الحصة"} />
                      ) : (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                          ملف الفيديو غير مضبوط. أعد لصق Telegram file_id من لوحة التحكم.
                        </div>
                      )
                    )
                  ) : r.kind === "photo" ? (
                    <img src={`/api/public/media/${r.file_id}`} alt={r.file_name || ""} className="w-full rounded-xl" />
                  ) : r.kind === "audio" ? (
                    <audio src={`/api/public/media/${r.file_id}`} controls className="w-full" />
                  ) : (
                    <a
                      href={`/api/public/media/${r.file_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold"
                    >
                      📥 تحميل / فتح
                    </a>
                  )}
                  {r.caption && <p className="text-sm text-muted-foreground mt-3">{r.caption}</p>}
                </article>
              ))}
            </div>
          )}

          <section className="grid gap-4 md:grid-cols-2">
            {q.data.quiz_id && (
              <Link
                to="/student/quizzes/$id"
                params={{ id: q.data.quiz_id }}
                className="surface-card p-5 hover:border-primary/40 transition text-center"
              >
                🧪 <span className="font-bold">امتحان الحصة</span>{q.data.quiz_title ? ` — ${q.data.quiz_title}` : ""} ←
              </Link>
            )}
            {(q.data.homework || []).map((h) => (
              <Link key={h.id} to="/student/homework" className="surface-card p-5 hover:border-primary/40 transition">
                <div className="font-bold">📝 {h.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {h.last_submission?.graded_at
                    ? `تم التصحيح: ${h.last_submission.score}/${h.max_score}`
                    : h.last_submission
                    ? "تم التسليم — بانتظار التصحيح"
                    : "لم يتم التسليم بعد"}
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function iconFor(kind: string) {
  return kind === "video" ? "🎬" : kind === "photo" ? "🖼️" : kind === "audio" ? "🎵" : kind === "link" ? "🔗" : "📄";
}

function googleDrivePreview(url?: string) {
  if (!url) return "";
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : "";
}

function SecureVideo({ src, title }: { src: string; title: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const syncTime = () => setCurrent(video.currentTime || 0);
    const syncDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const syncPlaying = () => setPlaying(!video.paused && !video.ended);
    const syncPaused = () => setPlaying(false);
    const onError = () => setFailed(true);
    setFailed(false);
    video.addEventListener("timeupdate", syncTime);
    video.addEventListener("loadedmetadata", syncDuration);
    video.addEventListener("durationchange", syncDuration);
    video.addEventListener("play", syncPlaying);
    video.addEventListener("pause", syncPaused);
    video.addEventListener("ended", syncPaused);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("timeupdate", syncTime);
      video.removeEventListener("loadedmetadata", syncDuration);
      video.removeEventListener("durationchange", syncDuration);
      video.removeEventListener("play", syncPlaying);
      video.removeEventListener("pause", syncPaused);
      video.removeEventListener("ended", syncPaused);
      video.removeEventListener("error", onError);
    };
  }, [src]);

  async function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      setFailed(true);
    }
  }

  function seek(value: string) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(value);
    video.currentTime = next;
    setCurrent(next);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  async function fullscreen() {
    const box = videoRef.current?.parentElement;
    if (!box) return;
    const target = box as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    await (target.requestFullscreen?.() || target.webkitRequestFullscreen?.());
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black aspect-video select-none" onContextMenu={(e) => e.preventDefault()}>
      <video
        ref={videoRef}
        src={src}
        aria-label={title}
        preload="metadata"
        playsInline
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        onClick={togglePlay}
        onContextMenu={(e) => e.preventDefault()}
        className="h-full w-full bg-black object-contain"
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "إيقاف مؤقت" : "تشغيل"}
        className="absolute inset-0 grid place-items-center bg-black/10 transition hover:bg-black/20"
      >
        {!playing && <span className="grid h-16 w-16 place-items-center rounded-full bg-primary/90 text-2xl text-primary-foreground shadow-lg">▶</span>}
      </button>
      {failed && (
        <div className="absolute inset-x-4 top-4 rounded-lg border border-destructive/40 bg-destructive/90 p-3 text-center text-sm text-destructive-foreground">
          تعذّر تشغيل الفيديو. تأكد من لصق Telegram file_id كامل من البوت.
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3">
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={Math.min(current, duration || current)}
          onChange={(e) => seek(e.target.value)}
          aria-label="موضع الفيديو"
          className="w-full accent-primary"
        />
        <div className="flex items-center gap-3 text-primary-foreground">
          <button type="button" onClick={togglePlay} aria-label={playing ? "إيقاف مؤقت" : "تشغيل"} className="text-xl leading-none">
            {playing ? "⏸" : "▶"}
          </button>
          <span className="min-w-20 text-xs tabular-nums">{formatTime(current)} / {formatTime(duration)}</span>
          <button type="button" onClick={toggleMute} aria-label={muted ? "تشغيل الصوت" : "كتم الصوت"} className="ms-auto text-lg leading-none">
            {muted ? "🔇" : "🔊"}
          </button>
          <button type="button" onClick={fullscreen} aria-label="ملء الشاشة" className="text-lg leading-none">⛶</button>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
