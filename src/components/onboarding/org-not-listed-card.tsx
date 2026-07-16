import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, Mail, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createOrganizationLead } from "@/lib/coach-org.functions";

interface Props {
  /** Pre-fill the club name if the coach picked one from search first. */
  initialClubName?: string;
  initialClubCity?: string;
  /** Called once the coach has taken any outreach action (or "later"). */
  onDone: () => void;
}

const DEFAULT_MESSAGE = (club: string) =>
  `Hey — I want to use Gradus to plan lessons and track progress for the athletes I coach at ${club || "our club"}. It's free for coaches once the club is set up. Can you take a look? https://gradus.training`;

/**
 * Outreach card shown when the coach's club isn't in the search results. Uses
 * the Web Share API on mobile (opens the OS share sheet — Messages, Mail,
 * WhatsApp, Slack, etc.) and falls back to Copy + mailto:/sms: on desktop.
 * Every outreach action writes an `organization_lead` for Gradus admins.
 */
export function OrgNotListedCard({
  initialClubName = "",
  initialClubCity = "",
  onDone,
}: Props) {
  const create = useServerFn(createOrganizationLead);
  const [clubName, setClubName] = useState(initialClubName);
  const [clubCity, setClubCity] = useState(initialClubCity);
  const [message, setMessage] = useState(DEFAULT_MESSAGE(initialClubName));
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const canShare = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function",
    [],
  );

  const record = async (channel: "share" | "copy" | "mailto" | "sms" | "later") => {
    if (!clubName.trim()) {
      toast.error("Add your club's name first.");
      return false;
    }
    setBusy(true);
    try {
      await create({
        data: {
          requestedOrgName: clubName.trim(),
          requestedOrgCity: clubCity.trim() || null,
          channel,
          messageBody: message.trim() || DEFAULT_MESSAGE(clubName.trim()),
        },
      });
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't save the request",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    const body = message.trim() || DEFAULT_MESSAGE(clubName.trim());
    if (canShare) {
      try {
        await navigator.share({
          title: `Bring ${clubName.trim() || "our club"} onto Gradus`,
          text: body,
        });
      } catch {
        // User dismissed the share sheet — treat as no-op, don't record.
        return;
      }
      const ok = await record("share");
      if (ok) {
        setSent(true);
        toast.success("Shared — we'll follow up when your club joins.");
      }
    } else {
      try {
        await navigator.clipboard.writeText(body);
        const ok = await record("copy");
        if (ok) {
          setSent(true);
          toast.success("Message copied — paste it wherever you like.");
        }
      } catch {
        toast.error("Couldn't copy — you can select and copy manually.");
      }
    }
  };

  const handleMailto = async () => {
    const body = message.trim() || DEFAULT_MESSAGE(clubName.trim());
    const url = `mailto:?subject=${encodeURIComponent(
      `Bring ${clubName.trim() || "our club"} onto Gradus`,
    )}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank", "noopener");
    const ok = await record("mailto");
    if (ok) setSent(true);
  };

  const handleSms = async () => {
    const body = message.trim() || DEFAULT_MESSAGE(clubName.trim());
    window.open(`sms:?&body=${encodeURIComponent(body)}`, "_blank", "noopener");
    const ok = await record("sms");
    if (ok) setSent(true);
  };

  const handleLater = async () => {
    const ok = await record("later");
    if (ok) onDone();
  };

  if (sent) {
    return (
      <div className="rounded-2xl border border-divider bg-card p-5 shadow-card">
        <h3 className="font-display text-h3 text-text-primary">
          Nice — we&apos;ll notify you if {clubName || "your club"} joins.
        </h3>
        <p className="mt-2 text-sm text-text-secondary">
          In the meantime, keep going as an Individual coach. When your club
          joins, we&apos;ll switch you over automatically — no double-charging.
        </p>
        <div className="mt-4">
          <Button onClick={onDone}>Continue as Individual for now</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-divider bg-card p-5 shadow-card">
      <h3 className="font-display text-h3 text-text-primary">
        Let&apos;s get {clubName || "your club"} on Gradus.
      </h3>
      <p className="mt-1 text-sm text-text-secondary">
        Send a quick message to whoever runs your club. When they join, your
        seat is covered.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="club-name">Club name</Label>
          <Input
            id="club-name"
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
            placeholder="Elite Skating Academy"
            maxLength={200}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="club-city">City or region (optional)</Label>
          <Input
            id="club-city"
            value={clubCity}
            onChange={(e) => setClubCity(e.target.value)}
            placeholder="Ashburn, VA"
            maxLength={120}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label htmlFor="club-message">Message</Label>
        <Textarea
          id="club-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          maxLength={2000}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button onClick={handleShare} disabled={busy}>
          {canShare ? (
            <>
              <Send className="h-4 w-4" />
              Share with my club
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy message
            </>
          )}
        </Button>
        <Button variant="ghost" onClick={handleMailto} disabled={busy}>
          <Mail className="h-4 w-4" />
          Email
        </Button>
        <Button variant="ghost" onClick={handleSms} disabled={busy}>
          <MessageSquare className="h-4 w-4" />
          Text
        </Button>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={handleLater}
          disabled={busy}
          className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
        >
          I&apos;ll send it later — continue as Individual for now
        </button>
      </div>
    </div>
  );
}
