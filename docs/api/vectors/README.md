# Shared test vectors

JSON vectors that both the TypeScript app and the native clients run against
(PRD §9.5 "Recurrence and formatting parity"). `gradus-ios` vendors this
directory into `Contract/vectors/` with `scripts/sync-contract.sh`; every
file here is part of the API contract and changes only by pull request.

Every file has the same envelope so a client can load any of them generically:

```json
{
  "description": "What the function does, in one paragraph.",
  "source": "path/to/the/canonical/implementation.ts",
  "cases": [{ "input": …, "expected": … }]
}
```

`input` and `expected` are function-specific; nothing else is allowed at the
top level. Keep the cases small and readable — they are documentation as
much as tests. Regenerate `expected` from the TypeScript implementation (it
is the source of truth); never hand-edit an expected value.

| File                       | Function                                                                                               | `input`                                                                                                                                                                                                    | `expected`              |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `name-normalization.json`  | `normalizeName` (`src/lib/board-types.ts`) — Live Board follow matching                                | string                                                                                                                                                                                                     | string                  |
| `session-labels.json` (I6) | session label formatting (the plan-session label helper; file named when the vectors land)             | `{ "date": ISO string, "timeZone": IANA zone, "locale"?: BCP 47 }`                                                                                                                                         | string                  |
| `lesson-recurrence.json`   | `expandSlotOccurrences` (`src/lib/lesson-recurrence.ts`) — lesson slot expansion for the week schedule | `{ "slot": { "dayOfWeek": 0–6, "frequency": "weekly" \| "biweekly" \| "twice_monthly" \| "monthly", "weeksOfMonth": [1–5], "startsOn": "YYYY-MM-DD" \| null }, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` | array of `"YYYY-MM-DD"` |

The `session-labels.json` row records the agreed shape ahead of I6; the file lands with that milestone. Cases in `lesson-recurrence.json` also carry a `name`.
