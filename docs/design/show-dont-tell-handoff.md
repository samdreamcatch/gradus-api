# Show, don't tell: design system handoff

The decisions from the October 2026 redesign, for a system-wide update in **gradus-ios** and **gradus-android**. Everything here is decided; nothing is open unless it says so.

- **Canvas (the visual source of truth):** https://claude.ai/artifact/6bUwfU8oiUGMP6HhrPrLuQ. Light and dark boards for every screen named below.
- **iOS reference implementation:** local branch `explore/show-dont-tell` in the worktree `~/Developer/gradus-ios-wt/show-dont-tell`. It is not pushed and has no PR. File and API names below point into it. Treat it as a working prototype: several screens run on mock data behind `-GradusDemo…` launch flags (listed at the end).
- **Android:** no implementation yet. Each section has a "Compose" note for the equivalent.

---

## 1. Principles

1. **Show, don't tell.** Cut the explainer sentence before adding anything. Prefer, in order:
   - a visible state change
   - an existing visual (practice ring, level track, FlowBars, tags, chips)
   - edit-in-place
   
   A sentence that must survive moves to the VoiceOver/TalkBack hint, or to a tap-to-explain sheet. AI-written content (briefings, summaries, recaps) is content, not explainer text, so leave it alone.
2. **One title per screen.** No nav-bar title on top of a page title. No field label that repeats the page title; keep it as the accessibility label instead. Uppercase section labels go wherever the content already makes the section obvious.
3. **Icons replace words; they never decorate them.** A pen instead of "Edit" or a speaker instead of "Read aloud" is good. An icon sitting beside the word it repeats is not. No decorative glyphs inside tags. No initials avatars.
4. **Accessibility target is WCAG AAA.**
   - Colour is never the only cue.
   - Graphics need 3:1.
   - Every hand-drawn mark is hidden from VoiceOver, with the state carried in the element's label.
   - Under Reduce Motion, nothing draws on.
   - Under Increase Contrast, strokes get heavier.
5. **Reuse before inventing.** New UI uses design-system components and existing screen patterns. If a pattern appears twice, it becomes one component (the picker field, the editing outline and the target stepper all came out of this rule).

---

## 2. Colour, type, surfaces

- **Tokens unchanged:** navy text on the lined-paper background.
  - `accent` is lime in light mode and cyan in dark.
  - `accentInk` is dark olive in light and cyan in dark. Use it whenever a green mark has to pass 3:1. Plain lime fails.
- **Content cards are borderless:** soft fill and shadow only (`GradusColor.cardEdge = .clear`). Controls (fields, buttons, chips) keep their edges. Increase Contrast puts card edges back.
- **Display serif:** EB Garamond, heavier. `gradusDisplay` defaults to `.bold`, and hero numbers use `.heavy`.
- **Hero numbers** sit on the page-title stripe (the same `pageTitleStripe` token and the same dark-mode fade, about 0.35). Used on the invoicing collected total, the invoice total and competition placings, and nothing else on a screen. iOS: `.heroHighlight()` (PenMarks.swift).
- **Mood words:** Hard (frustrated) · Just right (engaged) · Easy (comfortable). They appear on the check-in scale and on FlowBars, and the lime sits on Just right. The in-between points read **"A bit hard" / "A bit easy"** everywhere (Mariah, 2026-10-14; replaces A44's "A little").

---

## 3. Buttons

- **One lime button per screen:** the action that finishes the screen's job (Activate & Share, Update & Share, Bill $140, Send, Save results, Finish).
  - Everything else is outlined (`.chip` / secondary), including actions repeated on every row (Bill, Mark paid, Generate plan, Accept, Edit plan).
  - A disabled primary goes pale.
  - Kept exception: the SafeSport hotline Call buttons stay lime.
- **The plan mic** is outlined at rest and turns lime only while it's listening, so lime on it signals a state.
- **Primary buttons name what happens:** "Bill $140", "Activate & Share with Greta". No sentence explains the button.
- **Sheets dismiss with "Close", top left, every time.** "Cancel" stays only for inline mini-forms (an open save row) and the watch.

---

## 4. The pen layer (hand-drawn marks)

A hand-drawn mark means a person's hand is on it. There are three uses, and only these:

1. **Something changed state:**
   - a new time underlined, with the old one struck through
   - checks on an invoice
   - "Sent" circled once it goes out
   - a message seen
   - a setup step crossed off
2. **Done or chosen:** every checkmark is a pen tick inside a crisp box or circle (`PenCheckbox`), including chips, the move picker, invoice lines, terms and section ticks. iOS menus and the watch keep system checkmarks.
3. **You're editing it right now:** see §5.

Also pen: the orange flag that marks something worth a conversation (§8.3).

Never pen: buttons, charts, data, tallies. Each mark is seeded so it never wobbles between renders. iOS: `PenMarks.swift` (`PenMarkView`, `PenCheckbox`, `StepDots`).

Compose: draw marks with a seeded `Path` in a `Canvas`. Keep the same jitter so marks match iOS.

---

## 5. Editing state (the rough outline)

**The rule: wherever the cursor is blinking, or whatever you're actively editing, gets the hand-drawn outline. Leave it, and it goes back to crisp.**

- **One component:** `EditingOutline` (2pt, `accentInk`, the same roughness everywhere). It is green in light mode and cyan in dark. Never hand-draw a second variant.
- **Text fields:** `GradusTextFieldStyle` shows a crisp grey edge at rest and `EditingOutline` while focused. That outline is also the focus indicator (2pt, 3:1; WCAG 2.4.13). Fields that draw their own box use `.gradusEditingEdge(focused:)`. Search boxes use `GradusSearchField`.
- **Fields have vertical padding (12pt),** so a multi-line field's first line doesn't sit on its top edge.
- **Where else it appears:**
  - the move open for editing in the plan builder
  - moves landing during Talk it through, until you approve
- **Where it doesn't appear:** saved or final content, collapsed draft moves, filled or AI-drafted fields you're not in.
- **Known gap:** the Report sheet's note field still uses a plain iOS form field.

Compose: one `Modifier.editingEdge(focused)` and one `EditingOutline()` composable, used by every `TextField`.

---

## 6. Fields and pickers

- **One picker field:** `.gradusPickerField(isEmpty:)` (iOS only; watchOS has no menu pickers). It's boxed like a text field, with the value in plain text and the menu chevrons. While nothing's chosen, the edge is dashed and the placeholder muted (the look "Choose who this is for" set). All 18 menu pickers use it: sport, category, levels, lesson day and time, athlete pickers, schedule import and more.
- **One target control:** `TargetStepper`, shown as "− 20 reps +". Tap the unit to switch to minutes. It's used in the plan builder and in New move. No Reps/Mins segment plus number box.
- **Labels:** fields keep their labels (WCAG 3.3.2) as an eyebrow, a placeholder or an accessibility label. A single-field screen whose title names the field drops the visible label.

Compose: `ExposedDropdownMenuBox` wrapped in the same boxed, dashed-when-empty style.

---

## 7. Screen decisions

### Roster
- **Live** sits inline in the page-title row; there's no nav bar on root tabs.
- **Week strip:** lessons are crisp tally marks in `accentInk`, four strokes and a fifth across. Over ten, it shows a number. The selected day has dark marks on the lime pill. iOS: `TallyMarks`.
- **Day header:** just "Today" or the weekday. The strip already shows the date.
- **Lesson card:**
  - Opens to FlowBars since the last lesson and the ring (percent of the weekly target, with the target listed).
  - The status chip ("On track") sits beside the percent.
  - The profile button sits beside the athlete's name.
  - Message and reschedule are icons.
- **Moved lesson:** the new time is underlined and the old one struck through. There's no "Rescheduled" tag.
- **Get set up widget:** keep it. Collapsed, it's a lime pill showing the mark, "Get set up" and `StepDots`, not a bare mark with a number. Finished steps get a pen strike and a pen check. iOS: `HelpBubble(progress:)`.

### Athlete card
- **No 30-day text summary.** The chart and the ring carry it.
- **How practice felt:** the "Mirror" chart. It is final, so build it to the canvas boards "Mirror (3M, default)", "Mirror, a week held" and "Mirror (1Y)".
  - **Layout:** one column per week. Just right blocks centre on a midline, harder blocks stack up and easier blocks stack down. The labels HARDER and EASIER mark the two halves.
  - **Colours:** lime with a dark edge for Just right, grey for the "a bit" ratings, navy for Hard and Easy. Direction, not colour, separates harder from easier.
  - **Above the chart:** "N% just right" as the hero, on the stripe.
  - **Below the chart:** a key, always visible.
  - **Controls:** a range switch (1M · 3M · 1Y · All) and plan filter chips. There's no second chart or toggle.
  - **Holding a week:** pressing and holding a week dims the others and shows "Sep 21–27 · 2 a bit easy · …".
  - **Moments:** competitions show as dots, notes as small circles, along the top.
  - The current iOS `PracticeTrendChart` (weekly mix plus calendar) is superseded; rebuild it as the Mirror.
- **Goals from parent and athlete:**
  - "Now Juvenile", then a table: one row per person, with target and date.
  - The newest target gets the pen underline.
  - When the targets differ, a hand-drawn orange flag appears with "Talk it over with Ingrid", which opens a message to her with both targets.
- **Plans:** cards with FlowBars. A Gradus starter plan or an athlete-made plan carries a tag on its card ("Gradus", "By Greta"). There's no Adopt button, and coaches adopting starter plans is not needed.
- **Competitions:** each row shows the placing as the hero with the score under it. The Add menu offers Live board (skating) or Enter results (any sport, with the PDF attached, never photos).
- **Competition result:** a GOE bar per element from a centre line (lime to the right for gained, orange to the left for lost), component bars, and "Build a plan from this" under the cards.
- **Another coach's plan:** laid out like any plan, read-only, with a lock by the coach's name, no edit pens, and the shared "Message <coach> about this plan" button.

### Plan builder
- **Drafts are built in steps:** the heading "New plan", then **For**, **Name** and **Moves**, then notes.
  - Each step gets a pen tick once filled. "Untitled plan" counts as empty.
  - The primary reads "Activate & Share with <first name>".
- **Active plans:** the name is the page title, who it's for sits right under it, and logged practice starts folded.
- **A move:**
  - Tap it to read it; there's no outline yet.
  - The always-visible pen switches on editing. Phones have no hover, so it can't be hover-only.
  - While editing, the move gets the editing outline, its name becomes the title, and the target becomes the stepper. Description, cue and why are tap-to-edit, with no per-field pencils. Move up, move down and delete live in the ⋯ menu.
  - **"Done"** (a word) ends editing.
- **Edits from Gradus (voice or generated):** each touched move gets a tag: New, Changed, or Reps/Minutes. The header shows "N changes". There's no separate "Looks good"; Update & Share keeps the changes.
- **Add moves:** library sections fold away, and a folded section shows how many of its moves are picked. A search box sits at the top.
- **New move:** name, sport, category and target first, then one card holding "Draft with AI" with the cue, why and description it fills in. There are no "Drafted by AI" captions; VoiceOver still says it.
- **Talk it through:** the plan builds while you talk. Each landing move gets the editing outline and a check, and the newest gets the "just changed" underline.

### Invoicing
- **Hero:** the collected total, then "of $X", then one bar: paid solid, sent pale, still to bill as the empty track.
- **Filter:** the To bill · Sent · Paid totals are the filter. The chosen one gets a loose pen underline.
- **Lists:** plain lists in one card, every row the same height. Row actions are verbs: "Bill" and "Mark paid". There are no symbols in invoicing.
- **Bill, Invoice created and An invoice** share one shape: one card pinned to the top, with the button under it.
- **Receipt:** pen ticks on the lessons, and the total on the stripe. "Sent" is circled only after Send.

### Messages
- **List timestamps** follow iMessage: the time today, then "Yesterday", the weekday within the week, then the date. iOS: `MessageFormatting.listTime`.
- **Unread:** one marker, the count.
- **Sender names** show once per run of messages.
- **Seen** is a small pen check after the time.
- **Replies and reactions:** long-press for Reply and React (👍 ❤️ 😂 🔥 👏). A reply quotes the message it answers. Reactions are pinned to the top corner of their message, iMessage-style. *This needs API support; it is mock-only today.*
- **Prompts from Gradus** (for example "How did Winter Classic go?") arrive as a notification plus a "Gradus" message in Messages, not as a banner on Plans. *This needs a Gradus sender in the API.*

### Parent and athlete
- **Check-in:** the question is "How was practice today?". There's a five-point scale with the feeling words under the labels. Session length is a time with a pen; tapping it opens a minutes wheel.
- **Goals:** pens for edit. The ring shows percent of the weekly target, with the target listed.

### Onboarding
- **Create an account:** three plain choices, with no subtitles or icons.
- **Setup:** `StepDots` replaces "step 1 of 2", and there are no nav-bar titles. Field labels that repeat the title are dropped.
- **Invite code:** the field shows the format (ABCD2345). The explanation lives in VoiceOver.

---

## 8. Patterns worth naming

1. **Section ticks:** a pen tick in a circle beside a step label once it's filled. iOS: `sectionTick` in PlanDetailView.
2. **Change tags:** New, Changed, or the field that changed, as `GradusTag`.
3. **Worth a conversation:** the orange hand-drawn flag plus "Talk it over with <name>". Use it wherever two people's inputs disagree.
4. **Hero number:** a big serif number on the stripe, one per screen.

---

## 9. Mock-only flags (iOS prototype)

These only make the canvas screenshots possible. Don't ship them.

| Flag | What it shows |
|---|---|
| `-GradusDemoClean` | Hides banners for clean shots |
| `-GradusDemoVoiceLive` | Talk it through mid-recording |
| `-GradusDemoChanges` | A plan Gradus just changed (change tags) |
| `-GradusDemoReactions` | Seeded replies and reactions |
| `-GradusDemoGradusNote` | The Gradus prompt in Messages |
| `-GradusDemoResultForm`, `-GradusDemoChartSelect` | Competition and chart states |

The screenshot harness lives in `Tools/SDTShots`.

---

## 10. Suggested order for the update

1. **Tokens and surfaces:** borderless cards, the heavier serif, the hero stripe.
2. **Shared components:**
   - `EditingOutline` and the field style
   - the picker field
   - `TargetStepper`
   - `PenCheckbox`, `StepDots` and `TallyMarks`
   - the reaction pill
3. **The button pass:** one lime per screen, and Close on every sheet.
4. **Screens:** plan builder, roster, athlete card (including the Mirror chart), invoicing, messages, parent, onboarding.
5. **API work:** replies and reactions, the Gradus sender, unbilled lessons per athlete for invoicing.
6. **An accessibility pass** against §1.4, in light, dark and Increase Contrast, with VoiceOver and TalkBack.
