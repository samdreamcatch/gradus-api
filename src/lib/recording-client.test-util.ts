/**
 * A recording fake Supabase client for server-module tests: every query is
 * logged with its table, operation, payload and filters, and `answer` decides
 * what it returns (`one` is a `maybeSingle()`/`single()` read, `many` an
 * awaited query). Lets a test assert that a write named its owner.
 */
export type Filter = [method: string, column: string, value: unknown];
export type Call = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: Filter[];
};

export function recordingClient(
  answer: (call: Call, kind: "one" | "many") => { data: unknown; error?: unknown } | undefined,
) {
  const calls: Call[] = [];
  const chain = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    const self: Record<string, unknown> = {};
    const settle = (kind: "one" | "many") => {
      const res = answer(call, kind) ?? { data: kind === "one" ? null : [] };
      return { data: res.data, error: res.error ?? null };
    };
    for (const m of ["select", "insert", "update", "delete"] as const) {
      self[m] = (payload?: unknown) => {
        if (m !== "select" || call.op === "select") call.op = m;
        if (m === "insert" || m === "update") call.payload = payload;
        return self;
      };
    }
    for (const m of ["eq", "neq", "in", "is", "lt", "lte", "gte"]) {
      self[m] = (column: string, value: unknown) => {
        call.filters.push([m, column, value]);
        return self;
      };
    }
    self.order = () => self;
    self.limit = () => self;
    self.range = () => self;
    self.maybeSingle = async () => {
      calls.push(call);
      return settle("one");
    };
    self.single = async () => {
      calls.push(call);
      return settle("one");
    };
    self.then = (resolve: (v: unknown) => void) => {
      calls.push(call);
      resolve(settle("many"));
    };
    return self;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { from: (table: string) => chain(table) } as any;
  return { client, calls };
}
