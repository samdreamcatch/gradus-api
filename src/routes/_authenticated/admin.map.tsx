import { useMemo } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "reactflow";
import "reactflow/dist/style.css";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getAdminConnectionMap } from "@/lib/admin.functions";

const searchSchema = z.object({
  test: fallback(z.boolean(), false).default(false),
});

export const Route = createFileRoute("/_authenticated/admin/map")({
  validateSearch: zodValidator(searchSchema),
  component: AdminMap,
});

type NodeKind = "coach" | "parent" | "athlete";

function AdminMap() {
  const navigate = useNavigate();
  const { test: includeTest } = Route.useSearch();
  const fn = useServerFn(getAdminConnectionMap);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-connection-map", includeTest],
    queryFn: () => fn({ data: { includeTest } }),
  });

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Layout: coaches in a left column, athletes in middle, parents on right.
    // Within each column, distribute vertically with even spacing.
    const colX = { coach: 0, athlete: 520, parent: 1040 };
    const ySpacing = 90;

    const yFor = (i: number, total: number) =>
      i * ySpacing - ((total - 1) * ySpacing) / 2;

    data.coaches.forEach((c, i) => {
      nodes.push({
        id: `coach:${c.id}`,
        position: { x: colX.coach, y: yFor(i, data.coaches.length) },
        data: { label: c.name, kind: "coach" as NodeKind, userId: c.userId },
        style: nodeStyle("coach"),
        sourcePosition: "right" as any,
        targetPosition: "left" as any,
      });
    });

    data.athletes.forEach((a, i) => {
      nodes.push({
        id: `athlete:${a.id}`,
        position: { x: colX.athlete, y: yFor(i, data.athletes.length) },
        data: { label: a.name, kind: "athlete" as NodeKind, userId: null },
        style: nodeStyle("athlete"),
        sourcePosition: "right" as any,
        targetPosition: "left" as any,
      });
    });

    data.parents.forEach((p, i) => {
      nodes.push({
        id: `parent:${p.id}`,
        position: { x: colX.parent, y: yFor(i, data.parents.length) },
        data: { label: p.name, kind: "parent" as NodeKind, userId: p.userId },
        style: nodeStyle("parent"),
        sourcePosition: "right" as any,
        targetPosition: "left" as any,
      });
    });

    // Coach ↔ Athlete edges (rostered relationship)
    data.coachAthletes.forEach((ca, i) => {
      edges.push({
        id: `ca:${i}`,
        source: `coach:${ca.coachId}`,
        target: `athlete:${ca.athleteId}`,
        style: { stroke: "var(--pen-pool)", strokeWidth: 1.5 },
      });
    });

    // Athlete ↔ Parent edges
    data.athletes.forEach((a) => {
      if (a.parentId) {
        edges.push({
          id: `ap:${a.id}`,
          source: `athlete:${a.id}`,
          target: `parent:${a.parentId}`,
          style: { stroke: "var(--pen-tennis)", strokeWidth: 1.5 },
        });
      }
    });

    // Parent → Coach (signup via coach code)
    data.parents.forEach((p) => {
      if (p.coachId) {
        edges.push({
          id: `pc:${p.id}`,
          source: `coach:${p.coachId}`,
          target: `parent:${p.id}`,
          style: { stroke: "var(--pen-orange)", strokeWidth: 1.5, strokeDasharray: "4 4" },
          animated: false,
        });
      }
    });

    return { nodes, edges };
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 space-y-6">
      <Link to="/admin" className="text-sm text-accent-ink underline-offset-4 hover:underline">
        ← Back to admin
      </Link>

      <header className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-widest text-accent-ink">Internal</p>
        <h1 className="font-display text-h1 text-text-primary">Connection map</h1>
        <p className="text-sm text-text-secondary">
          Coaches, athletes, and parents and the links between them. Click a coach or parent to open their detail page. Pan and zoom with mouse / trackpad.
        </p>
      </header>

      <div className="flex items-center justify-between gap-3">
        <Legend />
        <Link
          from={Route.fullPath}
          search={(prev: any) => ({ ...prev, test: !includeTest })}
          className={`rounded-pill border px-3 py-1 text-xs font-medium uppercase tracking-wider transition ${
            includeTest
              ? "border-accent bg-accent text-accent-foreground"
              : "border-divider bg-card text-text-secondary hover:bg-elevated"
          }`}
        >
          {includeTest ? "Test users: on" : "Test users: hidden"}
        </Link>
      </div>

      <div className="h-[70vh] rounded-xl border border-divider bg-card overflow-hidden">
        {isLoading ? (
          <p className="p-4 text-sm text-text-secondary">Loading…</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            minZoom={0.1}
            maxZoom={2}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            onNodeClick={(_, node) => {
              const userId = (node.data as any)?.userId as string | null;
              if (userId) navigate({ to: "/admin/users/$userId", params: { userId } });
            }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

function nodeStyle(kind: NodeKind): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 600,
    border: "1px solid var(--divider)",
    background: "var(--card)",
    color: "var(--text-primary)",
    minWidth: 140,
    textAlign: "center",
  };
  if (kind === "coach") return { ...base, borderColor: "var(--pen-pool)", background: "var(--pen-pool-wash)", color: "var(--pen-pool-ink)" };
  if (kind === "parent") return { ...base, borderColor: "var(--pen-orange)", background: "var(--pen-orange-wash)", color: "var(--pen-orange-ink)" };
  return { ...base, borderColor: "var(--pen-tennis)", background: "var(--pen-tennis-wash)", color: "var(--pen-tennis-ink)" };
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 rounded-xl border border-divider bg-card p-3 text-xs">
      <Swatch color="var(--pen-pool)" label="Coach" />
      <Swatch color="var(--pen-tennis)" label="Athlete" />
      <Swatch color="var(--pen-orange)" label="Parent" />
      <span className="mx-2 h-4 w-px bg-divider" />
      <LineSwatch color="var(--pen-pool)" label="Coach rosters athlete" />
      <LineSwatch color="var(--pen-tennis)" label="Athlete belongs to parent" />
      <LineSwatch color="var(--pen-orange)" dashed label="Parent signed up via coach code" />
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-block h-3 w-3 rounded-full border border-divider" style={{ background: color }} />
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}

function LineSwatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-block h-0 w-6"
        style={{
          borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      <span className="text-text-secondary">{label}</span>
    </span>
  );
}
