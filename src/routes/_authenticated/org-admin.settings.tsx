import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getOrgAdminContext } from "@/lib/org-admin.functions";
import { getClubContract } from "@/lib/club-contract.functions";
import { sportDisplayLabel } from "@/lib/coach-sports";
import { PageTitle } from "@/components/page-title";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ClubTable } from "@/components/org-admin/club-table";
import { ClubStatusLegend } from "@/components/org-admin/status-dot";
import { TableBody, TableRow, TableCell, TableHead } from "@/components/ui/table";

const settingsOptions = () =>
  queryOptions({
    queryKey: ["club-contract"],
    queryFn: async () => {
      const context = await getOrgAdminContext();
      const org = context.organizations[0];
      if (!org) throw new Error("No club is available.");
      return getClubContract({ data: { organizationId: org.id } });
    },
  });

export const Route = createFileRoute("/_authenticated/org-admin/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Gradus Club" },
      { name: "description", content: "Club details and contracted Gradus seats and terms." },
      { property: "og:title", content: "Settings · Gradus Club" },
      {
        property: "og:description",
        content: "Club details and contracted Gradus seats and terms.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsOptions()),
  component: OrgSettings,
});

function OrgSettings() {
  const {
    data: { club, sports, code },
  } = useSuspenseQuery(settingsOptions());
  const [search, setSearch] = useState("");
  const clubRows = [
    ["Name", club.name],
    ["City", [club.city, club.region].filter(Boolean).join(", ") || "—"],
    ["Listed in club search", club.is_listed ? "Yes" : "No"],
    ["Coach invite code", code ?? "—"],
    ["Sports", sports.map(sportDisplayLabel).join(", ") || "Not set"],
    ["Storefront", club.storefront_enabled ? "Enabled" : "Not enabled"],
  ];
  const contractRows = [
    ["Coach seats", String(club.coach_seats)],
    ["Admin seats", String(club.admin_seats)],
    ["Storefront share", `${club.storefront_share_bps / 100}%`],
    ["Term", `${club.contract_starts_on ?? "Not set"} – ${club.contract_ends_on ?? "Not set"}`],
    ["Signed", club.contract_signed_on ?? "Not set"],
    ["Payouts", "Not connected"],
  ];
  const matches = (row: string[]) => row.join(" ").toLowerCase().includes(search.toLowerCase());
  function exportCsv() {
    const rows = [
      ["Section", "Field", "Value"],
      ...clubRows.filter(matches).map((r) => ["Club page", ...r]),
      ...contractRows.filter(matches).map((r) => ["Contract", ...r]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "club-settings.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTitle>Settings</PageTitle>
        <Button variant="outline" className="min-h-11" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <div className="space-y-3">
        <Input
          aria-label="Search club settings"
          placeholder="Search club settings"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-h-11 sm:max-w-md"
        />
        <ClubStatusLegend />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {[
          { name: "Club page", rows: clubRows },
          { name: "Contract", rows: contractRows },
        ].map((section) => (
          <section key={section.name} className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-h3">{section.name}</h2>
              {section.name === "Contract" && club.contract_file_url?.startsWith("https://") && (
                <Button asChild variant="link" className="min-h-11 text-text-primary">
                  <a href={club.contract_file_url} target="_blank" rel="noopener noreferrer">
                    Open the agreement
                  </a>
                </Button>
              )}
            </div>
            <ClubTable>
              <TableBody>
                {section.rows.filter(matches).map(([key, value]) => (
                  <TableRow key={key}>
                    <TableHead scope="row" className="w-2/5">
                      {key}
                    </TableHead>
                    <TableCell
                      className={
                        section.name === "Contract" ? "font-mono tabular-nums" : "break-words"
                      }
                    >
                      {value}
                    </TableCell>
                  </TableRow>
                ))}
                {!section.rows.some(matches) && (
                  <TableRow>
                    <TableCell colSpan={2}>No matching settings.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </ClubTable>
          </section>
        ))}
      </div>
    </div>
  );
}
