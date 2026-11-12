import { describe, expect, it } from "bun:test";
import { reportPlanInput, updatePlanReportInput } from "./plan-reports-types";
import {
  listPlanReports,
  reportPlan,
  updatePlanReport,
  type PlanReportsContext,
} from "./plan-reports.server";

const PLAN = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REPORT = "7b2f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

type Row = Record<string, unknown>;
type Call = { table: string; op: string; payload?: unknown; filters: unknown[][] };

/**
 * A query builder over in-memory tables: `eq`/`in` filter rows, the rest is
 * recorded. `insert`/`update` answer with `writeResult`.
 */
function fakeClient(tables: Record<string, Row[]>, writeResult: Row | null = null) {
  const calls: Call[] = [];
  const client = {
    from: (table: string) => {
      let rows = [...(tables[table] ?? [])];
      const call: Call = { table, op: "select", filters: [] };
      calls.push(call);
      const result = () => (call.op === "select" ? rows : writeResult ? [writeResult] : []);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          call.filters.push(["eq", col, val]);
          rows = rows.filter((r) => r[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: result()[0] ?? null, error: null }),
        single: () => Promise.resolve({ data: result()[0] ?? null, error: null }),
        insert: (payload: unknown) => {
          call.op = "insert";
          call.payload = payload;
          return chain;
        },
        update: (payload: unknown) => {
          call.op = "update";
          call.payload = payload;
          return chain;
        },
        then: (resolve: (v: unknown) => void) => resolve({ data: result(), error: null }),
      };
      return chain;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as PlanReportsContext["supabase"];
  return { client, calls };
}

const listedPlan = {
  id: PLAN,
  title: "Edge Control Foundations",
  status: "active",
  coach_id: "c1",
  coach: {
    user_id: "u-coach",
    first_name: "Tami",
    last_name: "Taylor",
    subscription_tier: "coach_pro",
    organization_id: null,
  },
};

describe("inputs", () => {
  it("takes the app's three reasons and an optional note", () => {
    for (const reason of ["inappropriate", "misleading", "unsafe"]) {
      expect(reportPlanInput.safeParse({ reason }).success).toBe(true);
    }
    expect(reportPlanInput.parse({ reason: "unsafe" }).note).toBe("");
    expect(reportPlanInput.safeParse({ reason: "spam" }).success).toBe(false);
    expect(reportPlanInput.safeParse({ reason: "unsafe", note: "x".repeat(2001) }).success).toBe(
      false,
    );
  });

  it("closes a report with a known status only", () => {
    expect(updatePlanReportInput.safeParse({ id: REPORT, status: "dismissed" }).success).toBe(true);
    expect(updatePlanReportInput.safeParse({ id: REPORT, status: "deleted" }).success).toBe(false);
  });
});

describe("reportPlan", () => {
  it("hides a plan the caller can't see that isn't a marketplace listing", async () => {
    const user = fakeClient({ plans: [] });
    const admin = fakeClient({
      plans: [{ ...listedPlan, coach: { ...listedPlan.coach, subscription_tier: "coach" } }],
    });
    await expect(
      reportPlan({ userId: "u-parent", supabase: user.client, admin: admin.client }, PLAN, {
        reason: "misleading",
        note: "",
      }),
    ).rejects.toThrow("Plan not found");
  });

  it("won't let a coach report their own plan", async () => {
    const user = fakeClient({ plans: [] });
    const admin = fakeClient({ plans: [listedPlan] });
    await expect(
      reportPlan({ userId: "u-coach", supabase: user.client, admin: admin.client }, PLAN, {
        reason: "unsafe",
        note: "",
      }),
    ).rejects.toThrow("You can't report your own plan.");
  });

  it("files a report with the plan's title and coach", async () => {
    const user = fakeClient({ plans: [] });
    const admin = fakeClient({ plans: [listedPlan], plan_reports: [] }, { id: REPORT });
    const res = await reportPlan(
      { userId: "u-parent", supabase: user.client, admin: admin.client },
      PLAN,
      { reason: "unsafe", note: "The jump drill has no warm-up." },
    );
    expect(res).toEqual({ ok: true, reportId: REPORT, alreadyReported: false });
    expect(
      admin.calls.find((c) => c.table === "plan_reports" && c.op === "insert")?.payload,
    ).toEqual({
      plan_id: PLAN,
      plan_title: "Edge Control Foundations",
      coach_id: "c1",
      reporter_user_id: "u-parent",
      reason: "unsafe",
      note: "The jump drill has no warm-up.",
    });
  });

  it("files nothing new while the caller's earlier report is open", async () => {
    const user = fakeClient({ plans: [] });
    const admin = fakeClient({
      plans: [listedPlan],
      plan_reports: [{ id: REPORT, plan_id: PLAN, reporter_user_id: "u-parent", status: "open" }],
    });
    const res = await reportPlan(
      { userId: "u-parent", supabase: user.client, admin: admin.client },
      PLAN,
      { reason: "inappropriate", note: "" },
    );
    expect(res).toEqual({ ok: true, reportId: REPORT, alreadyReported: true });
    expect(admin.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("lets a buyer report their own copy, which isn't a listing", async () => {
    const copy = {
      ...listedPlan,
      status: "active",
      coach: { ...listedPlan.coach, subscription_tier: "coach" },
    };
    const user = fakeClient({ plans: [{ id: PLAN }] });
    const admin = fakeClient({ plans: [copy], plan_reports: [] }, { id: REPORT });
    const res = await reportPlan(
      { userId: "u-parent", supabase: user.client, admin: admin.client },
      PLAN,
      { reason: "misleading", note: "" },
    );
    expect(res.alreadyReported).toBe(false);
  });
});

describe("admin", () => {
  it("lists reports with the coach's and reporter's names", async () => {
    const { client } = fakeClient({
      plan_reports: [
        {
          id: REPORT,
          plan_id: PLAN,
          plan_title: "Edge Control Foundations",
          coach_id: "c1",
          reporter_user_id: "u-parent",
          reason: "unsafe",
          note: "",
          status: "open",
          admin_notes: "",
          created_at: "2026-11-12T10:00:00.000Z",
          updated_at: "2026-11-12T10:00:00.000Z",
        },
      ],
      coach_profiles: [{ id: "c1", first_name: "Tami", last_name: "Taylor" }],
      parent_profiles: [
        { id: "p1", user_id: "u-parent", first_name: "Lorelai", last_name: "Gilmore" },
      ],
    });
    const [report] = await listPlanReports(client, { openOnly: true });
    expect(report.coachName).toBe("Tami Taylor");
    expect(report.reporter.userId).toBe("u-parent");
    expect(report.reason).toBe("unsafe");
  });

  it("closes a report, and 404s for one that doesn't exist", async () => {
    const found = fakeClient({}, { id: REPORT });
    await updatePlanReport(found.client, {
      id: REPORT,
      status: "actioned",
      adminNotes: "Plan unlisted",
    });
    expect(found.calls.find((c) => c.op === "update")?.payload).toEqual({
      status: "actioned",
      admin_notes: "Plan unlisted",
    });
    const missing = fakeClient({});
    await expect(
      updatePlanReport(missing.client, { id: REPORT, status: "dismissed" }),
    ).rejects.toThrow("Report not found");
  });
});
