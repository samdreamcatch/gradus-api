# Admin: Ask the data

A new admin page (Reporting → Ask the data) where you type a plain-English question
— "how many minutes of training has Brinkley logged?", "which coaches have plans
with no sessions logged?" — and get back a table of results plus the query that
produced it.

How it works for you:

1. Type a question and hit Ask.
2. Gradus turns it into a read-only database query using a description of your
   tables, runs it, and shows the rows in a table.
3. You can see the generated query, tweak it by hand and re-run, export the rows
   to CSV, or save the question as a shortcut for next time.

Safety: only admins can open the page, and only read-only queries are ever
allowed to run. Anything that would change or delete data is rejected before it
reaches the database, and every query is capped in rows and runtime.
