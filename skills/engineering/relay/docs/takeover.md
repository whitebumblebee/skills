# Taking over another agent's task

For the agent. Read this when a task you want is claimed by someone else.

## When you may take it

Take a claim held by another agent with `--force` only when:

- `relay status` shows the claim as **EXPIRED**, or
- **the user asked you to continue or pick up that task.** That is a
  reassignment — do not ask them again.

```bash
relay claim <task> --agent <you> --force
```

## When you may not

Otherwise `relay claim` refuses and prints evidence:

- when the holder was last active
- the logs it wrote since claiming
- its likely leftover work — uncommitted changes with git, or files modified
  since the claim without it

Show that to the user and ask. **Never take a live claim on your own
judgement.** A crashed agent and one still working in another window look
identical in the files.

## After any takeover

Assume the previous agent left work but no log.

1. **Inspect the leftover work before editing.** With git: `git status` and
   `git diff`. Without git: read the files `relay claim` listed.
2. Decide what to keep, finish, or undo.
3. Record the takeover in your log: who held the task, what you found, and
   what you kept.

## Your own claim

Claims expire after an hour. Re-run the same `relay claim` between major steps
— after each test run, say — to renew it; `relay log` renews it too. A claim
that stops being renewed is how everyone else learns you are gone.
