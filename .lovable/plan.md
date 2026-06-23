## What I'll change

In `src/routes/signup.athlete.account.tsx`, just under the email `<Input>` (where the password hint "At least 8 characters." currently lives for the password field), add a two-line helper:

> Use an email no one else has signed up with. **Tip:** if your parent uses Gmail, iCloud, or Outlook, they can give you `theirname+yourname@gmail.com` — the verification email lands in their inbox, but you get your own login. [ⓘ How does this work?]

The **ⓘ How does this work?** is a small inline trigger (icon + underlined link, no new route) that opens a shadcn `Popover` with the longer explanation:

> Most big email providers (Gmail, iCloud, Outlook, Fastmail, ProtonMail) ignore anything after a `+` in the address. So `mom@gmail.com` and `mom+jamie@gmail.com` both deliver to mom's inbox — but to Gradus they're two different accounts. That means your parent can confirm your account from their email, and you still get to log in as you.
>
> Heads up: a few providers (Yahoo, some company emails) don't support this. If the verification email never arrives, ask your parent to use a different free email like Gmail.

## Why a popover, not a separate page

- You picked inline-only, so no new route or doc page to maintain.
- A popover keeps the form short for the 95% who already get it, and gives the longer caveat-aware explanation to the 5% who tap.
- Uses the existing `@/components/ui/popover` primitive — already styled to the design system, no new dependencies.

## Technical correctness recap (so it's in the plan, not just the chat)

- Plus-addressing is a real RFC 5233 feature. Gmail, iCloud, Outlook, Fastmail, ProtonMail honor it.
- Supabase Auth's `users.email` unique constraint is a literal string compare, so `mom@gmail.com` and `mom+jamie@gmail.com` coexist as separate auth users with separate sessions and passwords — exactly what we want.
- Yahoo uses `-` instead of `+`, and a handful of corporate/ISP mailservers strip aliases — hence the "heads up" sentence so support tickets don't pile up.

## Files touched

- `src/routes/signup.athlete.account.tsx` — add the helper text + popover under the email field; import `Popover`, `PopoverTrigger`, `PopoverContent` from `@/components/ui/popover` and the `Info` icon from `lucide-react`.

No new routes, no new components, no backend changes.
