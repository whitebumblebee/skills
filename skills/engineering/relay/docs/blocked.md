# When you are blocked

For the agent. Read this when you cannot finish a task, or when the next step
needs the human.

## Blocked on something

```bash
relay block <task> --reason "exactly what is needed, and by whom"
```

Keep the task open. In your log, record:

- the blocker type — missing access, failing dependency, unclear requirement
- the exact non-secret error
- what you already tried
- whether retrying is safe

Write the reason for someone with none of your context. "Blocked on OAuth" is
useless six hours later; "human must add
`https://staging.example.com/api/auth/callback/google` as an authorised
redirect URI on the OAuth client" is actionable.

## When the human has to do it

Some things an agent cannot or must not do alone: OAuth consent screens,
billing, DNS, account verification, product judgement, anything irreversible.

1. Consolidate them into **one numbered message**. For each item give the exact
   URL or path, the exact values that are safe to share, and how you will
   verify it afterwards.
2. Mark the task `BLOCKED` and keep tasks that depend on it blocked.
3. Do not mark it done until the human confirms. Then record their
   confirmation in your log.
