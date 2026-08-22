# Mask names of athletes you aren't connected to yet

Today, when a coach imports a schedule or adds an athlete and we look for an existing Gradus account, the match card shows the existing athlete's **full name** and their **guardian's full name** — even when that athlete has no connection to this coach. That's more identity than a stranger should be able to pull out of the system by typing a name.

## The change

Any match candidate the coach is **not already connected to** is shown redacted:

- Athlete name: `Sasha Whitfield` becomes `Sasha W.`
- Guardian name: `Parent: Dana Whitfield` becomes `Parent: Dana W.`
- Email stays masked exactly as it is today (`d••••@gmail.com`)
- Sport / level stay visible — they help confirm a match without identifying anyone

Candidates already on the coach's roster keep their full names — the coach is already connected to them.

Once the coach links or invites and the connection is real, the athlete appears everywhere with their full name as normal. Nothing changes after connection.

## Where it shows up

- Import schedule sheet — the "Matches an existing Gradus account" candidate list
- Add-athlete flow in the lesson slot sheet — the match review step

Both read the same server response, so both are fixed by the same change.

## Technical notes

- Redaction happens **server-side** in `src/lib/schedule-import.functions.ts`, in the match builder, not in the components. The full name never leaves the server for an unconnected candidate, so it can't be read out of the network response.
- `MatchCandidate.name` and `guardianName` become already-display-safe values; add a `redacted: boolean` flag so the UI can label the row (e.g. a small "Not connected yet" note) if useful.
- The existing `onRoster` flag is the connection test.
- Helper: `firstNameLastInitial(first, last)` — returns `First L.` (drops the initial cleanly when there's no last name).
- The invite/link paths (`suggestedAthleteId`, athlete IDs) are unchanged, so linking still works exactly as before.
