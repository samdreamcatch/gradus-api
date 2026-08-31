import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
  SettingsButtonRow,
} from "@/components/settings/primitives";
import { listMyBlocks, unblockUser } from "@/lib/safety.functions";

/** Blocked-people list + unblock, shown on the Account & security sub-page. */
export function BlockedUsersSection() {
  const qc = useQueryClient();
  const fetchBlocks = useServerFn(listMyBlocks);
  const unblock = useServerFn(unblockUser);

  const { data, isLoading } = useQuery({
    queryKey: ["my-blocks"],
    queryFn: () => fetchBlocks(),
  });

  const mutation = useMutation({
    mutationFn: unblock,
    onSuccess: () => {
      toast("Unblocked.", { description: "You can message each other again." });
      void qc.invalidateQueries({ queryKey: ["my-blocks"] });
      void qc.invalidateQueries({ queryKey: ["message-rooms"] });
    },
    onError: (e) =>
      toast.error("Couldn't unblock", {
        description: e instanceof Error ? e.message : "Please try again.",
      }),
  });

  const blocks = data?.blocks ?? [];

  return (
    <SettingsGroup label="Blocked">
      <SettingsList>
        {isLoading ? (
          <SettingsRow icon={<Ban className="size-4" />} label="Loading…" />
        ) : blocks.length === 0 ? (
          <SettingsRow
            icon={<Ban className="size-4" />}
            label="No blocked people"
            description="Blocking someone stops all messages between you."
          />
        ) : (
          blocks.map((b) => (
            <SettingsButtonRow
              key={b.userId}
              icon={<Ban className="size-4" />}
              label={b.name}
              description={b.role === "unknown" ? "Blocked" : `Blocked ${b.role}`}
              trailing={<span className="text-xs text-accent-ink">Unblock</span>}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ data: { targetUserId: b.userId } })}
            />
          ))
        )}
      </SettingsList>
    </SettingsGroup>
  );
}
