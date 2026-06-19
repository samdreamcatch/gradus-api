# Add Gymnastics Sport Library

Add **Gymnastics** as the 5th built-in sport with USAG Development Program levels and a deduplicated, category-normalized move library.

## 1. Built-in sport catalog (`src/lib/coach-sports.ts`)

- Extend `SportKey` union to include `"gymnastics"`.
- Append a `gymnastics` entry to `SPORTS`:
  - **label**: "Gymnastics"
  - **standard**: "USA Gymnastics Development Program"
  - **levels** (11): `level_1` through `level_10`, plus `elite`
  - **suggestedHours** (research-based, scales with USAG training norms):
    - L1: 2, L2: 3, L3: 4, L4: 8, L5: 12, L6: 16, L7: 20, L8: 22, L9: 24, L10: 28, Elite: 32

## 2. Move data — deduplication & normalization

The user-provided list of 50 rows resolves to **42 unique moves** after merging duplicates:

**Duplicates merged** (keeping the longer, more detailed version):
- Kip / Kip (glide kip) → "Kip"
- Cast to handstand (×2) → keep longer description
- Back walkover (×2) → keep longer description
- Round-off (×2) → keep longer description
- Split leap (×2) → keep longer description
- Front walkover (×2) → keep longer description
- Back handspring (×2) → keep longer description
- Giant swing (×2) → keep longer description

**Categories normalized** to canonical event names:
- "Floor" → **Floor Exercise**
- "Bars" → **Uneven Bars**
- "Beam" → **Balance Beam**
- Keep as-is: **Vault**, **Pommel Horse**, **Parallel Bars**, **Rings**, **Artistry**, **Conditioning**

Final category set: Floor Exercise, Uneven Bars, Balance Beam, Vault, Pommel Horse, Parallel Bars, Rings, Artistry, Conditioning.

## 3. Seed insert

Insert ~42 rows into `public.seed_moves` with `sport = 'gymnastics'`. Each row maps:
- `name`, `description`, `cue`, `why` ← provided text (longer variant when duplicated)
- `category` ← normalized name
- `default_target_kind` ← `reps` or `mins`
- `default_target_value` ← provided number

The existing `seed_coach_library` RPC picks these up for any coach who selects gymnastics.

## 4. No other code changes

- Sport-key validator already accepts arbitrary slugs.
- Onboarding multi-select renders Dance/Gymnastics automatically from `SPORTS`.
- Hours step pre-populates from `suggestedHours`.

## Technical notes

- Data insert via the data-insert tool (no schema change).
- Single `INSERT … VALUES` statement; single-quote escaping handled by Python codegen.
