import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareInviteButton } from "@/components/share/share-invite-button";

interface AthleteInviteCardProps {
  name: string;
  code: string | null;
  url: string | null;
}

export function AthleteInviteCard({ name, code, url }: AthleteInviteCardProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-2xl border border-divider bg-elevated p-5">
      <p className="font-display text-lg text-text-primary">{name}</p>
      {code && url ? (
        <>
          <div className="mt-4 flex items-center justify-center rounded-md bg-card p-4">
            <QRCodeSVG value={url} size={140} bgColor="transparent" />
          </div>
          <ShareInviteButton
            url={url}
            title={`Invite ${name} to Gradus`}
            text={`${name} — tap to set up your Gradus athlete account. It'll link straight to me.`}
            className="mt-3 w-full"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-sm tracking-[0.25em] uppercase text-text-secondary">
              {code}
            </span>
            <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy code">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-text-tertiary">Generating code…</p>
      )}
    </div>
  );
}
