import { ClubTag } from "./club-tag";

export function ClubPersonCell({ name, email }: { name?: string | null; email?: string | null }) {
  if (name?.trim()) return <span className="font-sans">{name.trim()}</span>;
  if (email?.trim()) return <span className="inline-flex items-center gap-2 font-sans"><span>{email.trim()}</span><ClubTag>Invited</ClubTag></span>;
  return <span className="text-text-tertiary" aria-label="No value">–</span>;
}