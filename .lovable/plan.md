## Trim parenthetical from SMS invite body

In `src/routes/signup.athlete.tsx`, update the prefilled SMS body on the "Send them an invite" link.

- **Before:** `Hey — I want to sign up for Gradus (the training app my coach uses). Can you make a parent account so you can add me? https://gradus.training/signup/parent`
- **After:** `Hey — I want to sign up for Gradus. Can you make a parent account so you can add me? https://gradus.training/signup/parent`

No other changes.
