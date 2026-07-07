## Match birthday label size to other field labels

On `/signup/parent/athletes`, the "Your athlete's birthday" label currently uses `className="text-xs text-text-secondary"`, which makes it visibly smaller and lighter than the sibling field labels "Your name" and "Your athlete(s)" (which use the default `<Label>` styling — `text-sm` weight-medium in the primary ink color).

### Change

- File: `src/routes/signup.parent.athletes.tsx`, line 213
- Remove the `className="text-xs text-text-secondary"` override on the birthday `<Label>` so it inherits the default Label styling and matches "Your name" / "Your athlete(s)".

No other changes.
