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
  getRoomActivePlans,
  markRoomRead,
  sendMessage,
  type MessageDTO,
  type RoleInRoom,
  type RoomKind,
} from "@/lib/messages.functions";
import { getOtherCoachPlanForMessage } from "@/lib/coach-athlete-detail.functions";
import { OtherCoachPlansSheet } from "@/components/coach/other-coach-plans-sheet";
import { voiceTranscribe } from "@/lib/voice.functions";
import { useVoiceCapture } from "@/hooks/use-voice-capture";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  onReport,
  onBlock,
}: {
  others: { role: RoleInRoom; firstName: string; userId: string | null }[];
  onReport: (userId: string, name: string) => void;
  onBlock: (userId: string, name: string) => void;
}) {
  const ordered = [...others].sort((a, b) => {
    const rank = (r: RoleInRoom) => (r === "athlete" ? 0 : r === "parent" ? 1 : 2);
    return rank(a.role) - rank(b.role);
  });
  const actionable = ordered.filter((p) => !!p.userId);
  return (
    <div className="relative flex flex-col items-center gap-1 pb-4">
      <p className="text-base font-bold text-text-primary">
        {ordered.map((p) => p.firstName).join(" & ")}
      </p>
      <p className="text-caption font-black uppercase tracking-widest text-text-tertiary">
        {ordered.map((p) => roleWord(p.role)).join(" · ")}
      </p>
      {actionable.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Conversation options"
              className="press-soft absolute right-0 top-0 inline-flex size-8 items-center justify-center rounded-full text-text-tertiary"
            >
              <MoreVertical className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            {actionable.map((p) => (
              <div key={p.userId} className="py-1">
                {actionable.length > 1 ? (
                  <p className="px-2 pb-1 text-caption font-black uppercase tracking-widest text-text-tertiary">
                    {p.firstName}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => onReport(p.userId!, p.firstName)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text-primary"
                >
                  <Flag className="size-4" /> Report {p.firstName}
                </button>
                <button
                  type="button"
                  onClick={() => onBlock(p.userId!, p.firstName)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-destructive"
                >
                  <Ban className="size-4" /> Block {p.firstName}
                </button>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
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
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
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
  const fetchOtherPlan = useServerFn(getOtherCoachPlanForMessage);
  const [otherPlanId, setOtherPlanId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["message-room", viewerRole ?? "default", roomId],
    queryFn: () => fetchRoom({ data: { roomId, viewerRole } }),
  });

  const messages: MessageDTO[] = useMemo(() => data?.messages ?? [], [data]);
  const room = data?.room;

  const { data: otherPlanData } = useQuery({
    queryKey: ["other-coach-plan-for-message", otherPlanId],
    queryFn: () => fetchOtherPlan({ data: { planId: otherPlanId! } }),
    enabled: !!otherPlanId,
  });

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
          queryClient.invalidateQueries({
            queryKey: ["message-room", viewerRole ?? "default", roomId],
          });
          queryClient.invalidateQueries({ queryKey: ["message-rooms"] });
          queryClient.invalidateQueries({ queryKey: ["messages-unread-total"] });
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
      queryClient.invalidateQueries({
        queryKey: ["message-room", viewerRole ?? "default", roomId],
      });
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
        others={room.participants.filter((p) => p.userId !== room.myUserId)}
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
                const senderDeleted = !!m.senderDeletedAt || m.senderUserId === null;
                const mine = !senderDeleted && m.senderUserId === room.myUserId;
                const otherReaders = m.readBy.filter((r) => r.userId !== room.myUserId);
                return (
                  <div
                    key={m.id}
                    className={cn("flex flex-col", mine ? "items-end" : "items-start")}
                  >
                    {!mine ? (
                      <p className="mb-0.5 px-2 text-caption font-black uppercase tracking-widest text-text-tertiary">
                        {senderDeleted
                          ? `${roleWord(m.senderRole)} (deleted account)`
                          : `${roleWord(m.senderRole)} ${m.senderFirstName}`}
                      </p>
                    ) : null}
                    {m.plan ? (
                      room.myRole === "coach" &&
                      m.plan.coachId &&
                      room.myCoachId &&
                      m.plan.coachId !== room.myCoachId ? (
                        <button
                          type="button"
                          onClick={() => setOtherPlanId(m.plan!.id)}
                          className={cn(
                            "mb-1 inline-flex max-w-[78%] items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-caption font-black uppercase tracking-widest text-accent-ink ring-1 ring-accent/30 press",
                          )}
                        >
                          <ClipboardList className="size-3" />
                          <span className="truncate normal-case tracking-normal text-xs font-bold">
                            {m.plan.title}
                          </span>
                        </button>
                      ) : (
                        <Link
                          to={planHrefForRole(room.myRole, m.plan.id)}
                          className={cn(
                            "mb-1 inline-flex max-w-[78%] items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-caption font-black uppercase tracking-widest text-accent-ink ring-1 ring-accent/30 hover:bg-accent/25",
                          )}
                        >
                          <ClipboardList className="size-3" />
                          <span className="truncate normal-case tracking-normal text-xs font-bold">
                            {m.plan.title}
                          </span>
                        </Link>
                      )
                    ) : null}
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug",
                        mine
                          ? "bg-accent text-accent-foreground rounded-br-md shadow-card"
                          : "bg-card text-text-primary rounded-bl-md shadow-card",
                      )}
                    >
                      {senderDeleted ? (
                        <span className="italic opacity-70">Message deleted</span>
                      ) : m.kind === "voice" ? (
                        <VoiceBubble url={m.audioUrl} duration={m.durationSeconds} />
                      ) : (
                        <span className="whitespace-pre-wrap break-words">{m.body}</span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 px-2 text-micro font-bold uppercase tracking-widest text-text-tertiary",
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
        roomKind={room.kind}
        viewerRole={viewerRole}
        disabled={sendTextMutation.isPending}
        onSendText={(body, planId) => sendTextMutation.mutate({ body, planId })}
      />
      <OtherCoachPlansSheet
        coach={otherPlanData?.coach ?? null}
        athleteFirstName={otherPlanData?.athleteFirstName ?? ""}
        onOpenChange={(open) => {
          if (!open) setOtherPlanId(null);
        }}
      />
    </div>
  );
}

function Composer({
  roomId,
  roomKind,
  viewerRole,
  disabled,
  onSendText,
}: {
  roomId: string;
  roomKind: RoomKind;
  viewerRole?: RoleInRoom;
  disabled: boolean;
  onSendText: (body: string, planId: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [attachedPlan, setAttachedPlan] = useState<{ id: string; title: string } | null>(null);
  const transcribeFn = useServerFn(voiceTranscribe);
  const fetchActivePlans = useServerFn(getRoomActivePlans);
  const canTagPlan = roomKind === "athlete";

  const { data: activePlansData } = useQuery({
    queryKey: ["room-active-plans", viewerRole ?? "default", roomId],
    queryFn: () => fetchActivePlans({ data: { roomId, viewerRole } }),
    enabled: canTagPlan,
  });
  const activePlans = activePlansData?.plans ?? [];
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const handleAttachClick = () => {
    if (attachedPlan) {
      setAttachedPlan(null);
      return;
    }
    if (activePlans.length === 0) {
      toast("No active plan", {
        description: "This athlete has no active plan to tag.",
      });
      return;
    }
    if (activePlans.length === 1) {
      setAttachedPlan(activePlans[0]);
      return;
    }
    setPickerOpen(true);
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
          {canTagPlan ? (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={handleAttachClick}
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
              </PopoverTrigger>
              <PopoverContent align="start" side="top" className="w-64 p-1">
                <p className="px-2 py-1.5 text-caption font-black uppercase tracking-widest text-text-tertiary">
                  Tag a plan
                </p>

                <div className="flex flex-col">
                  {activePlans.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setAttachedPlan(p);
                        setPickerOpen(false);
                      }}
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-text-primary hover:bg-elevated"
                    >
                      <ClipboardList className="size-3.5 text-accent-ink" />
                      <span className="truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
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
            className="focus-input min-h-10 max-h-32 flex-1 resize-none rounded-2xl border border-divider bg-card px-3.5 py-2 text-sm text-text-primary placeholder:text-text-tertiary"
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
      {voice.errorMsg ? <p className="mt-1 text-xs text-attention-ink">{voice.errorMsg}</p> : null}
    </div>
  );
}
