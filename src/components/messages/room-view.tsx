import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mic, Send, Square, Trash2, Play, Pause, Paperclip, X, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getRoom,
  getRoomActivePlan,
  markRoomRead,
  sendMessage,
  type MessageDTO,
  type RoleInRoom,
} from "@/lib/messages.functions";
import { voiceTranscribe } from "@/lib/voice.functions";
import { useVoiceCapture } from "@/hooks/use-voice-capture";

function roleWord(role: RoleInRoom): string {
  return role === "coach" ? "Coach" : role === "parent" ? "Parent" : "Athlete";
}

function planHrefForRole(role: RoleInRoom, planId: string): string {
  if (role === "coach") return `/coach/plans/${planId}`;
  if (role === "parent") return `/parent/plans/${planId}`;
  return `/athlete/plans/${planId}`;
}

function ConversationHeader({
  others,
}: {
  roomId: string;
  others: { role: RoleInRoom; firstName: string }[];
}) {
  const ordered = [...others].sort((a, b) => {
    const rank = (r: RoleInRoom) => (r === "athlete" ? 0 : r === "parent" ? 1 : 2);
    return rank(a.role) - rank(b.role);
  });
  return (
    <div className="flex flex-col items-center gap-1 pb-4">
      <p className="text-base font-bold text-text-primary">
        {ordered.map((p) => p.firstName).join(" & ")}
      </p>
      <p className="text-[11px] font-black uppercase tracking-widest text-text-tertiary">
        {ordered.map((p) => roleWord(p.role)).join(" · ")}
      </p>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtDayHeader(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function fmtDuration(s: number | null): string {
  if (!s || s < 1) return "0:00";
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
}

function VoiceBubble({ url, duration }: { url: string | null; duration: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onEnd = () => setPlaying(false);
    a.addEventListener("ended", onEnd);
    return () => a.removeEventListener("ended", onEnd);
  }, []);

  if (!url) {
    return <span className="italic opacity-70">Voice note unavailable</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (playing) {
            a.pause();
            setPlaying(false);
          } else {
            void a.play();
            setPlaying(true);
          }
        }}
        className="inline-flex size-8 items-center justify-center rounded-full bg-background/40 hover:bg-background/60"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <span className="text-xs font-bold tabular-nums opacity-80">{fmtDuration(duration)}</span>
      <audio ref={audioRef} src={url} preload="none" />
    </div>
  );
}

export function RoomView({ roomId, viewerRole }: { roomId: string; viewerRole?: RoleInRoom }) {
  const fetchRoom = useServerFn(getRoom);
  const sendFn = useServerFn(sendMessage);
  const markRead = useServerFn(markRoomRead);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["message-room", viewerRole ?? "default", roomId],
    queryFn: () => fetchRoom({ data: { roomId, viewerRole } }),
  });

  const messages: MessageDTO[] = useMemo(() => data?.messages ?? [], [data]);
  const room = data?.room;

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!room) return;
    void markRead({ data: { roomId, viewerRole } }).then((r) => {
      if (r.marked > 0) {
        queryClient.invalidateQueries({ queryKey: ["messages-unread-total"] });
        queryClient.invalidateQueries({ queryKey: ["message-rooms"] });
      }
    });
  }, [room, messages.length, roomId, viewerRole, markRead, queryClient]);

  useEffect(() => {
    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["message-room", roomId] });
          queryClient.invalidateQueries({ queryKey: ["message-room", viewerRole ?? "default", roomId] });
          queryClient.invalidateQueries({ queryKey: ["message-rooms"] });
          queryClient.invalidateQueries({ queryKey: ["messages-unread-total"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["message-room", roomId] });
          queryClient.invalidateQueries({ queryKey: ["message-room", viewerRole ?? "default", roomId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId, viewerRole, queryClient]);

  const sendTextMutation = useMutation({
    mutationFn: (vars: { body: string; planId: string | null }) =>
      sendFn({ data: { roomId, kind: "text", body: vars.body, planId: vars.planId, viewerRole } }),
    onSuccess: (result) => {
      if (result && "ok" in result && result.ok === false) {
        toast.error("Couldn't send", { description: result.message });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["message-room", viewerRole ?? "default", roomId] });
      queryClient.invalidateQueries({ queryKey: ["message-rooms"] });
    },
    onError: (e) =>
      toast.error("Couldn't send", {
        description: e instanceof Error ? e.message : "Please try again.",
      }),
  });


  if (isLoading || !room) {
    return <p className="py-10 text-center text-sm text-text-secondary">Loading…</p>;
  }

  const groups: { day: string; items: MessageDTO[] }[] = [];
  for (const m of messages) {
    const day = fmtDayHeader(m.createdAt);
    const last = groups[groups.length - 1];
    if (!last || last.day !== day) groups.push({ day, items: [m] });
    else last.items.push(m);
  }

  return (
    <div className="flex h-[calc(100dvh-180px)] flex-col">
      <ConversationHeader
        roomId={roomId}
        others={room.participants.filter((p) => p.role !== room.myRole)}
      />
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <div className="space-y-5">
          {groups.length === 0 ? (
            <p className="py-10 text-center font-hand text-2xl text-text-secondary">
              No messages yet — say hello.
            </p>
          ) : null}
          {groups.map((group) => (
            <div key={group.day} className="space-y-2">
              <p className="text-center font-hand text-base text-text-tertiary">{group.day}</p>
              {group.items.map((m) => {
                const mine = m.senderUserId === room.myUserId;
                const otherReaders = m.readBy.filter((r) => r.userId !== room.myUserId);
                return (
                  <div
                    key={m.id}
                    className={cn("flex flex-col", mine ? "items-end" : "items-start")}
                  >
                    {!mine ? (
                      <p className="mb-0.5 px-2 text-[11px] font-black uppercase tracking-widest text-text-tertiary">
                        {roleWord(m.senderRole)} {m.senderFirstName}
                      </p>
                    ) : null}
                    {m.plan ? (
                      <Link
                        to={planHrefForRole(room.myRole, m.plan.id)}
                        className={cn(
                          "mb-1 inline-flex max-w-[78%] items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-black uppercase tracking-widest text-accent-ink ring-1 ring-accent/30 hover:bg-accent/25",
                        )}
                      >
                        <ClipboardList className="size-3" />
                        <span className="truncate normal-case tracking-normal text-xs font-bold">
                          {m.plan.title}
                        </span>
                      </Link>
                    ) : null}
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug",
                        mine
                          ? "bg-accent text-accent-foreground rounded-br-md shadow-card"
                          : "bg-card text-text-primary rounded-bl-md shadow-card",
                      )}
                    >
                      {m.kind === "voice" ? (
                        <VoiceBubble url={m.audioUrl} duration={m.durationSeconds} />
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{m.body}</span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 px-2 text-[10px] font-bold uppercase tracking-widest text-text-tertiary",
                        mine ? "text-right" : "text-left",
                      )}
                    >
                      {fmtTime(m.createdAt)}
                      {mine && otherReaders.length > 0 ? (
                        <span className="ml-1.5">· Seen</span>
                      ) : null}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Composer
        roomId={roomId}
        viewerRole={viewerRole}
        disabled={sendTextMutation.isPending}
        onSendText={(body, planId) => sendTextMutation.mutate({ body, planId })}
      />
    </div>
  );
}

function Composer({
  roomId,
  viewerRole,
  disabled,
  onSendText,
}: {
  roomId: string;
  viewerRole?: RoleInRoom;
  disabled: boolean;
  onSendText: (body: string, planId: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [attachedPlan, setAttachedPlan] = useState<{ id: string; title: string } | null>(null);
  const transcribeFn = useServerFn(voiceTranscribe);
  const fetchActivePlan = useServerFn(getRoomActivePlan);

  const { data: activePlanData } = useQuery({
    queryKey: ["room-active-plan", viewerRole ?? "default", roomId],
    queryFn: () => fetchActivePlan({ data: { roomId, viewerRole } }),
  });
  const activePlan = activePlanData?.plan ?? null;

  const voice = useVoiceCapture({
    maxMs: 90_000,
    onCapture: async (blob) => {
      setTranscribing(true);
      try {
        const fd = new FormData();
        fd.append("audio", blob, `voice.${blob.type.includes("mp4") ? "mp4" : "webm"}`);
        const { text: transcript } = await transcribeFn({ data: fd });
        setText((prev) => (prev.trim().length > 0 ? `${prev.trim()} ${transcript}` : transcript));
      } catch (e) {
        toast.error("Couldn't transcribe", {
          description: e instanceof Error ? e.message : "Please try again.",
        });
      } finally {
        setTranscribing(false);
      }
    },
  });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    onSendText(body, attachedPlan?.id ?? null);
    setText("");
    setAttachedPlan(null);
  };

  const recording = voice.state === "recording";
  const processing = voice.state === "processing" || transcribing;

  const toggleAttachPlan = () => {
    if (attachedPlan) {
      setAttachedPlan(null);
      return;
    }
    if (!activePlan) {
      toast("No active plan", {
        description: "This athlete has no active plan to tag.",
      });
      return;
    }
    setAttachedPlan(activePlan);
  };

  return (
    <div className="mt-3 border-t border-divider pt-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
      {attachedPlan ? (
        <div className="mb-2 flex items-center gap-2 rounded-full bg-accent/15 px-3 py-1.5 ring-1 ring-accent/30">
          <ClipboardList className="size-3.5 text-accent-ink" />
          <span className="flex-1 truncate text-xs font-bold text-accent-ink">
            Tagged to <span className="font-black">{attachedPlan.title}</span>
          </span>
          <button
            type="button"
            onClick={() => setAttachedPlan(null)}
            aria-label="Remove plan tag"
            className="inline-flex size-5 items-center justify-center rounded-full text-accent-ink hover:bg-accent/25"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : null}

      {recording ? (
        <div className="flex items-center gap-2 rounded-full bg-attention/15 px-3 py-2 ring-1 ring-attention/40">
          <span className="relative inline-flex size-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-attention opacity-70" />
            <span className="relative inline-flex size-2.5 rounded-full bg-attention" />
          </span>
          <span className="flex-1 text-sm font-bold text-attention-ink tabular-nums">
            Listening · {(voice.elapsedMs / 1000).toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={() => voice.cancel()}
            aria-label="Discard recording"
            className="inline-flex size-9 items-center justify-center rounded-full text-attention-ink hover:bg-attention/20"
          >
            <Trash2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => voice.stop()}
            aria-label="Stop and transcribe"
            className="inline-flex size-9 items-center justify-center rounded-full bg-attention text-attention-foreground"
          >
            <Square className="size-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={toggleAttachPlan}
            disabled={disabled || processing}
            aria-label={attachedPlan ? "Remove plan tag" : "Tag a plan"}
            aria-pressed={!!attachedPlan}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-full ring-1 transition-colors disabled:opacity-50",
              attachedPlan
                ? "bg-accent/20 text-accent-ink ring-accent/40"
                : "bg-elevated text-text-primary ring-divider hover:bg-divider",
            )}
          >
            <Paperclip className="size-4" />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={disabled}
            placeholder={transcribing ? "Transcribing…" : "Message…"}
            rows={1}
            className="min-h-10 max-h-32 flex-1 resize-none rounded-2xl border border-divider bg-card px-3.5 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          {text.trim().length > 0 ? (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || processing}
              aria-label="Send"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void voice.start()}
              disabled={disabled || processing}
              aria-label="Dictate message"
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-elevated text-text-primary ring-1 ring-divider hover:bg-divider disabled:opacity-50"
            >
              <Mic className="size-4" />
            </button>
          )}
        </div>
      )}
      {voice.errorMsg ? (
        <p className="mt-1 text-xs text-attention-ink">{voice.errorMsg}</p>
      ) : null}
    </div>
  );
}
