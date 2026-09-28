# Setting up relay — the agent's guide

This is for the agent doing setup. The user asked you to set up relay, or you
arrived to find setup unfinished. Your job is to leave `.relay/` in a state
where any other agent, in any tool, can start work from it cold.

You do this as an **interview**. Gather everything the project can tell you
first, form your own picture, then ask the user only what the project cannot
answer — and let them steer.

---

## 1. Run `init` and note the mode

```bash
relay init --harness <the tools this project uses>
```

It prints one of three modes. If you think it guessed wrong, say so and re-run
with `--mode new|git|code`.

| Mode | Means | Bootstrap entry |
| --- | --- | --- |
| **new** | Empty project, nothing built yet | none — history is legitimately empty |
| **git** | Existing work with git history | `0001_relay_bootstrap.md`, facts from git |
| **code** | Existing work, no usable git history | `0001_relay_bootstrap.md`, facts from the files |

If the project already keeps its own notes — handoff files, session logs,
plans, a changelog, a to-do list — they are the best history it has. Read them,
cite them under *Sources relied on* in the bootstrap entry, and port live
to-do items into `tasks.md`. Leave the originals in place unless the user asks
you to archive or remove them.

If `AGENTS.md`, `CLAUDE.md` or similar already existed, `init` added a marked
`<!-- relay:start -->` block and left the user's content alone. Do not delete
or rewrite their content without asking.

---

## 2. How to interview

These rules apply in every mode.

- **Facts first, questions second.** Never ask something the code, the git log,
  a manifest or a README already answers. Asking what the stack is when
  `package.json` is open in front of you wastes the user's attention, which is
  the scarcest thing in this process.
- **Small rounds.** Three to five questions at a time, grouped by topic, most
  important first. Use your tool's structured question feature if it has one;
  otherwise ask in chat.
- **Offer options, not blank prompts.** "Staging on Vercel preview deploys, a
  separate Fly app, or none for now?" gets a better answer than "Tell me about
  your environments."
- **State what you inferred, and let them correct it.** "It looks like a
  Next.js app with Postgres via Prisma, deployed to Vercel — right?" is one
  question that confirms five facts.
- **The user steers.** If they want to skip a topic, change direction, or say
  "you decide", record that and move on. Never block setup on a question they
  do not want to answer: write it down as **undecided** and continue.
- **Do not build anything during setup.** No CI files, no deploy config, no
  installs. Setup produces a plan; accepted suggestions become tasks that
  someone claims afterwards.

### Every suggestion gets a priority question

Whenever you suggest something — CI/CD, a staging environment, tests, error
monitoring, auth, payments, analytics, backups, anything — ask where it goes
in the order. Users differ: one wants CI on day one, another wants payments
before tests, another does not want deployments until the MVP works locally.

Offer these choices:

| Answer | What you do |
| --- | --- |
| **Now** | Task near the top of `tasks.md`, in the order the user gives |
| **Next** | Task in the next bucket or phase |
| **Later** | Task at the bottom, and a line in `PROJECT.md` → *Deferred and declined* saying when (e.g. "after first 100 users") |
| **Not needed** | No task. A line under *Deferred and declined* with the reason, so no agent suggests it again |

Batch suggestions so the user prioritises them together — "Here are five
things I would add; for each, now, next, later, or not needed?" — rather than
one question per suggestion.

**Order is priority.** Agents pick the first `TODO` from the top of
`tasks.md`, so the file order *is* the plan. Use the `Now` / `Next` / `Later`
headings, or replace them with phases (`## Phase 1 — MVP`,
`## Phase 2 — Launch`) if the user thinks in phases.

---

## 3. By mode

### New — empty project

Nothing to read, so the interview carries everything. Cover, in roughly this
order, adapting to what the user cares about:

1. **What it is.** The product in two sentences, who it is for, what "working"
   means for the first version.
2. **Core features.** What the MVP must do. Push for the smallest version that
   is useful; list the rest as later.
3. **Stack.** Their preferences and constraints. If they have none, suggest one
   that fits what they described, with a one-line reason — and treat it as a
   suggestion with a priority question like any other.
4. **Constraints and invariants.** Anything that must always hold: data
   privacy, budget limits, performance targets, "never store card numbers".
5. **Environments and deployment.** Suggest options that fit the stack; ask
   the priority.
6. **Quality gates.** Suggest the checks that should pass before work counts
   as done (type-check, lint, tests, build) and CI to enforce them; ask the
   priority.
7. **What needs the human.** Commits, deploys, spending, console-only work —
   confirm the defaults in the template and add their own.
8. **Phases.** Group the accepted work into phases or Now / Next / Later.

Write `PROJECT.md` as **intent, not description** — there is no code yet to
describe. Two real invariants beat a filled-in form. Mark undecided things as
undecided.

There is no bootstrap entry in this mode. The first real task someone logs
becomes `0001`.

### Git — existing project with git history

1. **Read the bootstrap facts** in `.relay/history/0001_relay_bootstrap.md`:
   commit range, contributors, recent commits, most-changed files, manifests,
   CI and deploy config, docs, existing agent instructions.
2. **Go deeper where the facts point.** `git log --stat` on recent work, the
   most-changed files, open branches (`git branch -a`), uncommitted changes.
   Read the README, docs, any `CHANGELOG`, and existing agent instructions.
3. **Read the code** enough to understand the architecture: entry points,
   routes or commands, data model, external services, tests, build and deploy.
4. **Form your own picture** before asking: what the product does, how mature
   it is, what looks half-done (stale branches, `TODO` comments, partial
   features), what looks risky (no tests around a hot file, secrets handling,
   migrations).
5. **Interview.** Open by stating your picture and asking the user to correct
   it. Then ask about what the history cannot tell you: which environment is
   dangerous, what must never change, what is half-done on purpose, what is
   known broken, **what they want to build next** — upcoming features and
   enhancements. Make suggestions where you see gaps, each with a priority
   question.
6. **Write everything** — see step 4 below.

### Code — existing project without git history

The user built something and there is no log of how. **Read and understand
the code before asking anything.** Your questions should show you already know
what the product does.

1. **Read the bootstrap facts.** They come from the working tree only; dates
   are file modification times and may be meaningless if the files were copied.
2. **Read the code thoroughly**: entry points, routes or commands, data model,
   integrations, configuration, tests, build scripts, deploy files, README,
   docs, any `CHANGELOG`, any notes or `TODO` files. A `CHANGELOG` is the
   closest thing to history this project has — use its timeline.
3. **Form your own information and opinion**: what the product does, who it
   seems to be for, what works, what looks unfinished, what looks fragile, and
   what you would improve.
4. **Interview.** Present your understanding and ask the user to correct it.
   Ask only what stayed unclear after reading. Then ask **what product
   enhancements they want next** — this is what fills `tasks.md`. Offer your
   own improvement suggestions, each with a priority question.
5. **Suggest `git init`** as one of those suggestions: without it, relay cannot
   track work done outside handoff logs, and there is no record of changes. Do
   not run it yourself.
6. **Write everything** — see step 4 below.

---

## 4. Write the artifacts

**`.relay/PROJECT.md`** — replace the template comments with real content.
Keep it to about a page; it is read at the start of every session.

- What the project is, in two or three sentences
- Architecture invariants — only the ones that are expensive to rediscover
- Environments, marking which one is dangerous
- Validation gates — exact commands
- Actions that need the human
- *Deferred and declined* — every "later" and "not needed" answer, with the reason

If the project already had agent instructions (`AGENTS.md`, `CLAUDE.md`,
`.cursor/rules/`), offer to move the project-specific rules into `PROJECT.md`
so they live in one place. Ask before removing anything from the user's files.

**`.relay/tasks.md`** — replace `first-task` with the real plan, **in the
user's priority order**. Short, stable slugs; one line of context under each
task where useful. Keep only what is actually intended; everything else lives
in *Deferred and declined*.

If another tracker exists (`TODO.md`, `plan.md`), port its live items into
`tasks.md` with the user, then either delete it or note in `PROJECT.md` that
`tasks.md` takes precedence — `relay doctor` warns until you do.

**`.relay/history/0001_relay_bootstrap.md`** (git and code modes) — keep the
generated facts, and fill in every other section: what the project is, where
it stands, half-done work, known broken or risky, sources relied on, next. Then
set the front-matter:

- `summary:` one line — what the project is and where it stands
- `next:` the first task in `tasks.md`, stated as an action
- `status:` `done`

Replace the `TODO:` placeholders — `relay doctor` fails with
`bootstrap-incomplete` until you do. Keep the filename and `agent: relay`; add
your own name in the body under *Sources relied on*.

Then:

```bash
relay index
relay doctor
```

---

## 5. Finish

Setup is done when:

- [ ] `relay doctor` passes
- [ ] `PROJECT.md` has no unanswered template comments — every topic is filled
      in or explicitly marked undecided
- [ ] `tasks.md` holds the real plan in the user's priority order
- [ ] every suggestion you made is either a task or under *Deferred and declined*
- [ ] in git and code modes, the bootstrap entry is complete

Tell the user, in a few lines: what mode this was, what you set up, the first
three tasks in order, and anything recorded as undecided. Remind them that
`.relay/` is meant to be committed — you do not commit it yourself unless they
ask.
