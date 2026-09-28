# Work you discover along the way

For the agent. Read this when you notice something outside your claimed task —
a bug, a refactor, a missing feature, anything you would suggest — or when
`relay status` finds no available task.

It becomes a new task, not something you do now.

1. **Check *Deferred and declined* in `.relay/PROJECT.md` first.** Never
   re-suggest what the user already postponed or turned down.
2. **Ask the user where it goes: now, next, later, or not needed.** Batch
   several findings into one question.
   - Add it to `tasks.md` as a `TODO` at that position. Order is priority:
     agents pick the first `TODO` from the top.
   - Record "later" and "not needed" under *Deferred and declined* with the
     reason.
3. **If you cannot ask,** add it at the bottom of `tasks.md` with the note
   `priority not confirmed`, and list it in your log.

Do it inside your current task only if it blocks that task, and say so in
your log.

If `relay status` finds no available task, tell the user and ask what comes
next. New work you propose follows the same rules.
