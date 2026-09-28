# How relay works — every scenario

Setup for an empty project, an existing project with git history, and an
existing project without git; then how agents pick up work and hand it off in
every case.

## Before any scenario: install

Once per project, run `npx skills add whitebumblebee/skills`, or add `--global` to install it for every project. After that, everything starts with one sentence to any agent: **"set up relay for this project."** The skill loads on that request because its description now covers setup.

## Part 1: Setup in each scenario

### Scenario 1: Empty project

1. **The agent runs `relay init`.** It reports "new project" and creates the `.relay/` templates plus a pointer file for each tool you use. History stays empty.
2. **It reads the "New" section of `docs/setup.md`** and interviews you in rounds of 3–5 questions:
   - what you're building and who it's for
   - the MVP features
   - stack (it suggests one if you have no preference)
   - constraints, such as budget or privacy
   - environments and deployment
   - quality checks and CI
   - what always needs you
3. **Every suggestion gets a priority question: now, next, later, or not needed.** It asks about several suggestions at once.
4. **It writes the plan.**
   - `PROJECT.md` describes what you intend to build.
   - `tasks.md` lists tasks in your order, grouped as phases or Now/Next/Later.
   - Your "later" and "not needed" answers go into _Deferred and declined_ with the reason.
5. **It finishes.** It runs `relay doctor`, which passes because empty history is fine for a new project. Then it tells you the first three tasks and anything left undecided. You commit `.relay/`.

**End state:** no history yet. The first real task an agent logs becomes `0001`.

### Scenario 2: Existing code with git history

1. **The agent runs `relay init`.** It reports "existing project with git history" and creates:
   - the templates
   - `0001_relay_bootstrap.md`, filled with facts from git: date range, contributors, recent commits, most-changed files, tags, scripts, CI and deploy config, and any `CHANGELOG` timeline
   - a marked relay section added to your existing `AGENTS.md` / `CLAUDE.md`, with your own text untouched

   If the project already has its own notes, such as handoff files, plans or a changelog, the agent reads them in step 3 and cites them in the bootstrap entry.

2. **Setup is now blocked until it's finished.** `relay status` shows "Setup is not finished", and `relay doctor` fails with `bootstrap-incomplete`. The pointer files carry the same warning, so an agent opened in a different tool also knows to finish setup first.
3. **The agent investigates before asking you anything.** It reads the bootstrap facts, then goes further: `git log --stat`, the most-changed files, branches, uncommitted changes, README, docs, `CHANGELOG`, your existing agent instructions, and the code itself.
4. **The interview opens with its picture of the project.** For example: "It looks like a Next.js shop with Prisma, deployed on Vercel. Is that right?" Then it asks what the history can't answer:
   - which environment is dangerous
   - what must never change
   - what's half-done on purpose
   - what's known to be broken
   - **what you want to build next**

   It also suggests fixes for gaps it found, each with the priority question.

5. **It writes everything.**
   - `PROJECT.md` and `tasks.md` in your order, with items ported from any old `TODO.md`.
   - It offers to move project rules from your `AGENTS.md` into `PROJECT.md`, and asks before removing anything.
   - It completes the bootstrap entry: the narrative sections and the sources it relied on. It sets `summary`, sets `next` to the first task, and marks the status `done`.
6. **It finishes.** It runs `relay index` and `relay doctor`, which now pass, and tells you what it set up. You commit.

**End state:** history holds `0001`, a summary of everything before relay. The next log is `0002`, and commit tracking is active.

### Scenario 3: Existing code, no git

This works like Scenario 2, with four differences:

- **The facts come only from the files,** and the dates are marked as a guess, since copying files resets them. A `CHANGELOG` becomes the timeline if there is one.
- **The agent reads the code thoroughly before asking anything,** and forms its own view: what the product does, what works, what's unfinished, what's fragile, and what it would improve.
- **The interview covers less ground.** The agent presents that view, asks only what stayed unclear, then asks what enhancements you want. Your answers fill `tasks.md`, and its own improvement ideas each get the priority question. `git init` is one of those suggestions, but it won't run it.
- **Commit tracking is off,** and `status` says so. If you later run `git init` and commit, tracking starts on its own.

A repo with only one commit is treated as this scenario, because the code is what needs reading.

## Part 2: How an agent picks up work

After setup, this is the same in all three scenarios, for every session in every tool:

1. **The tool loads relay's instructions,** from the pointer file (your `AGENTS.md` section, `CLAUDE.md`, or the Cursor rule) or from the skill.
2. **It finds the CLI** (on `PATH`, the project install, or the global install) and checks it runs.
3. **If setup is unfinished, it finishes setup first.**
4. **It reads the shared state:** `PROJECT.md`, `tasks.md`, `history.md` and the newest relevant logs. Then it runs `relay status`.
5. **It checks the actual repository.** If the code disagrees with the history, the code wins, and the agent says so in its log.
6. **It chooses a task:**
   - the one you name, if you name one
   - otherwise the next task `status` shows, which is the first `TODO` from the top of `tasks.md` (your priority order)
   - otherwise a task whose claim has expired

   It skips `BLOCKED` and `DONE` tasks, and tasks another agent has claimed. If nothing is available, it says so and asks you what comes next. Anything it proposes gets the same priority question as during setup.

7. **It claims the task** with `relay claim <task> --agent <its name>`. The claim expires in 1 hour.
8. **It works inside that task only.** It re-runs the same `claim` between major steps to renew it, and follows `PROJECT.md`: run the checks, never write secrets, no commits or deploys unless you ask. Anything it notices outside the task becomes a new task instead of extra work (case 10 below).

## Part 3: Every way work ends or passes on

**1. The task is finished.** The agent runs the checks, then `relay log`. The log must include a real summary, the single next action, and what was done, what was run with exact results, and any risks. Then it runs `relay done` (which links the task to that log) and `relay doctor`, which must pass. The next agent's `status` shows that summary and the next task.

**2. It stops mid-task on purpose,** because it's running low on context or credits. It writes `relay log --status partial` with the exact next step. Then there are two options:

- **It runs `relay block <task> --reason "handing off: …"`,** which releases the claim, so the next agent claims it normally.
- **It leaves the claim in place.** The claim expires within the hour, or you tell another agent to continue.

**3. It crashed with no log,** for example credits ran out mid-sentence. What happens next depends on you:

- **You tell another agent "continue what Claude was doing."** That counts as reassigning the task. The new agent runs `--force` immediately. relay lists where the old agent's leftover work probably is: uncommitted changes in a git project, or files modified since its claim in a project without git. The new agent inspects those, decides what to keep, and records the takeover in its log.
- **You say nothing, and the claim is still live.** The claim attempt is refused and shows evidence: when the holder was last active, any logs it wrote, and that same leftover-work list. The agent shows you that and asks, because a crashed agent looks identical to one still working in another window.
- **The claim has expired** (no renewal for an hour). `status` marks it EXPIRED and offers it as the next task. The agent may take it over without asking, then does the same inspection and records the takeover.

**4. It's blocked on you.** It runs `relay block` with the exact action needed, and puts everything that needs you into one numbered message. The task and anything that depends on it stay blocked. Once you confirm, an agent claims it again and records your confirmation.

**5. The same agent comes back in a new chat.** It remembers nothing, so it reads its own log like any other agent would. If its claim is still live, claiming again renews it. If the claim expired, it claims fresh.

**6. Two agents work at the same time.** Each claims a different task, and the second one is automatically shown the next task since the first is taken. relay doesn't lock files, so tasks should touch different areas. If both write a log at the same instant, they get the same number, and `doctor` reports it for someone to rename.

**7. Someone works outside relay,** such as you committing by hand or an agent without the skill. `status` shows "Commits since the last committed log: N", and `doctor` warns at 5. The next agent should write a log explaining those commits. This only works in git projects.

**8. An earlier log turns out to be wrong.** Logs are never edited. The agent writes a new log with `supersedes: [n]`.

**9. The CLI isn't available.** The agent follows the same protocol by editing the markdown files by hand.

**10. It notices work outside its task,** such as a bug, a refactor, or a feature it would suggest. It doesn't do it on the spot:

- It first checks _Deferred and declined_ in `PROJECT.md`, and never re-suggests what you already postponed or turned down.
- It asks you **now, next, later, or not needed**, batching several findings into one question, and adds a task at that position in `tasks.md`. "Later" and "not needed" go into _Deferred and declined_ with your reason.
- If it can't ask you, it adds the task at the bottom of `tasks.md` marked `priority not confirmed`, and lists it in its log so the next agent or you can settle it.

The only exception is work that blocks its current task. It can do that inside the task, and says so in its log.

**11. Every task is done.** `relay status` says so, and the agent asks whether to compact this round. If you agree:

- `relay compact` drafts one summary with the facts: every log's summary and `next`, the tasks done, dates, agents.
- The agent reads the round's logs and writes the summary with you. It opens with a short "What is true now", which every future agent reads. Anything that stays true, like rules and constraints, moves into `PROJECT.md`.
- `relay compact --finish` deletes the round's logs, makes the summary `0001`, and removes finished tasks. The next round starts at `0002`.

In a git project whose logs are committed, the deleted logs can be restored from the commit the summary records. Without git the deletion is permanent, so it asks you to confirm. You can ask for a compaction at any time; open tasks carry over, and only a task someone is actively working on blocks it.

## What still differs between scenarios after setup

|                                                    | Empty                                  | Git history                 | No git                                         |
| -------------------------------------------------- | -------------------------------------- | --------------------------- | ---------------------------------------------- |
| History starts at                                  | nothing; first task is `0001`          | `0001` bootstrap            | `0001` bootstrap                               |
| Commits without a log                              | tracked once the project has git       | tracked                     | off until you `git init`                       |
| After a takeover, the agent finds leftover work by | git's diff, or the listed files if no git | `git status` and `git diff` | reading the files relay lists as modified since the claim |
| Logs deleted by compaction | restorable once the project has git and the logs are committed | restorable if committed | permanent; you confirm first |

Without git, "modified since the claim" comes from file modification times. It's good enough to show where to look, but an edit made by something else in that window, such as you or a formatter, shows up too, so the agent still reads before trusting it.
