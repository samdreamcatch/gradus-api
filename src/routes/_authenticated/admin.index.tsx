import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getAdminOverview, searchUsers, setUserTestFlag } from "@/lib/admin.functions";
import { Chip } from "@/components/ui/chip";
import { Tag } from "@/components/ui/tag";

const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/")({
  validateSearch: zodValidator(searchSchema),
  component: AdminUsers,
});

function AdminUsers() {
  const { test: includeTest } = Route.useSearch();
  const searchFn = useServerFn(searchUsers);
  const toggleFn = useServerFn(setUserTestFlag);
  const overviewFn = useServerFn(getAdminOverview);
  const qc = useQueryClient();

  // Prime overview (also used by list/$kind pages)
  useQuery({
    queryKey: ["admin-overview", includeTest],
    queryFn: () => overviewFn({ data: { includeTest } }),
  });

  const toggleTest = async (userId: string, next: boolean) => {
    await toggleFn({ data: { userId, isTest: next } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-overview"] }),
      qc.invalidateQueries({ queryKey: ["admin-search"] }),
      qc.invalidateQueries({ queryKey: ["admin-user", userId] }),
    ]);
  };

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const { data: results, isFetching } = useQuery({
    queryKey: ["admin-search", submitted],
    queryFn: () => searchFn({ data: { query: submitted } }),
    enabled: submitted.length >= 2,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <header>
        <h2 className="font-display text-h2 text-text-primary">Users</h2>
        <p className="text-sm text-text-secondary">Search coaches, parents, and athletes.</p>
      </header>

      <section className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query.trim());
          }}
          className="flex gap-2"
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
          />
          <Button type="submit" disabled={query.trim().length < 2}>
            Search
          </Button>
        </form>

        {submitted.length >= 2 && (
          <div className="rounded-xl border border-divider bg-card">
            {isFetching ? (
              <p className="p-4 text-sm text-text-secondary">Searching…</p>
            ) : (results?.results ?? []).length === 0 ? (
              <p className="p-4 text-sm text-text-secondary">No matches.</p>
            ) : (
              <ul className="divide-y divide-divider">
                {results!.results.map((r) => (
                  <li key={`${r.kind}-${r.profileId}`} className="flex items-center gap-2 px-4 py-3 hover:bg-elevated">
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: r.userId }}
                      className="flex flex-1 items-center justify-between gap-4 min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text-primary">
                          {`${r.firstName} ${r.lastName}`.trim() || "(no name)"}
                          {r.isTest && <Tag className="ml-2">test</Tag>}
                        </p>
                        <p className="truncate text-xs text-text-secondary">{r.email ?? "—"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-mono uppercase text-accent-ink">{r.kind}</p>
                        <p className="text-xs text-text-tertiary">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </Link>
                    <TestToggle isTest={r.isTest} onToggle={() => toggleTest(r.userId, !r.isTest)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function TestToggle({ isTest, onToggle }: { isTest: boolean; onToggle: () => void }) {
  return (
    <Chip
      as="button"
      size="micro"
      mono
      selected={isTest}
      className="shrink-0"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      title={isTest ? "Unmark as test user" : "Mark as test user"}
    >
      {isTest ? "test ✓" : "test"}
    </Chip>
  );
}
