/**
 * tasks.md is the single authoritative tracker.
 *
 * One file, one format, one owner per task. Plans, designs and roadmaps may
 * exist alongside it, but they are subordinate: if a plan and tasks.md
 * disagree, tasks.md wins. The most common failure in multi-agent projects is
 * several half-maintained trackers with no declared precedence, and the cost
 * lands on whichever agent arrives last.
 */
import { UserError, addHours, nowIso, paths, read, readHistory, write } from "./core.mjs";
import { dirtyFiles, isGitRepo } from "./git.mjs";
import { scanTree } from "./adopt.mjs";

export const STATES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"];

const BOX = { TODO: " ", IN_PROGRESS: "~", BLOCKED: "!", DONE: "x" };

const LINE =
  /^(\s*)- \[([ x~!])\]\s+`([^`]+)`\s*(?:—|--)\s*([A-Z_]+)\s*(.*)$/;

/**
 * Parse every task line out of tasks.md, preserving position for rewrites.
 *
 * Lines inside fenced code blocks are skipped: tasks.md documents its own
 * format with worked examples, and without this the format documentation
 * registers as real tasks.
 */
export function readTasks(root) {
  const text = read(paths(root).tasks);
  if (text === null) return [];
  const lines = text.split(/\r?\n/);
  const tasks = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = LINE.exec(line);
    if (!m) return;
    const [, indent, , slug, state, rest] = m;
    const parts = rest
      // A leading separator is consumed by the state group above; drop any
      // stray one so the first field is not prefixed with an em dash.
      .replace(/^\s*(?:—|--)\s*/, "")
      .split(/\s*(?:—|--)\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    const task = {
      slug,
      state,
      indent,
      lineNo: i,
      raw: line,
      agent: null,
      claimedAt: null,
      seenAt: null,
      expiresAt: null,
      note: null,
      log: null,
    };
    if (state === "IN_PROGRESS") {
      task.agent = parts[0] || null;
      task.claimedAt = parts[1] || null;
      const field = (name) => {
        const p = parts.find((x) => x.startsWith(`${name} `));
        return p ? p.slice(name.length + 1).trim() : null;
      };
      task.seenAt = field("seen");
      task.expiresAt = field("expires");
    } else if (state === "BLOCKED") {
      task.note = parts.join(" — ") || null;
    } else if (state === "DONE") {
      task.log = parts[0] || null;
    }
    tasks.push(task);
  });
  return tasks;
}

export function findTask(root, slug) {
  const task = readTasks(root).find((t) => t.slug === slug);
  if (!task) {
    throw new UserError(
      `No task \`${slug}\` in ${paths(root).tasks}.\n` +
        `Add it as a line like:  - [ ] \`${slug}\` — TODO`,
    );
  }
  return task;
}

export function formatTaskLine(task) {
  const box = BOX[task.state];
  let line = `${task.indent}- [${box}] \`${task.slug}\` — ${task.state}`;
  if (task.state === "IN_PROGRESS") {
    line += ` — ${task.agent} — ${task.claimedAt}`;
    if (task.seenAt) line += ` — seen ${task.seenAt}`;
    if (task.expiresAt) line += ` — expires ${task.expiresAt}`;
  } else if (task.state === "BLOCKED" && task.note) {
    line += ` — ${task.note}`;
  } else if (task.state === "DONE" && task.log) {
    line += ` — ${task.log}`;
  }
  return line;
}

/**
 * Remove every DONE task, with its indented notes. Compaction uses this: the
 * logs a DONE task cites are about to be deleted, and the summary records them.
 */
export function removeDone(root) {
  const p = paths(root).tasks;
  const text = read(p);
  if (text === null) return [];
  const done = readTasks(root).filter((t) => t.state === "DONE");
  if (!done.length) return [];
  const lines = text.split(/\r?\n/);
  const drop = new Set();
  for (const t of done) {
    drop.add(t.lineNo);
    for (let i = t.lineNo + 1; i < lines.length; i += 1) {
      const indent = /^(\s*)/.exec(lines[i])[1].length;
      if (!lines[i].trim() || indent <= t.indent.length) break;
      drop.add(i);
    }
  }
  write(p, lines.filter((_, i) => !drop.has(i)).join("\n"));
  return done.map((t) => t.slug);
}

export function updateTask(root, slug, mutate) {
  const p = paths(root).tasks;
  const text = read(p);
  if (text === null) throw new UserError(`${p} does not exist. Run \`relay init\`.`);
  const task = findTask(root, slug);
  mutate(task);
  const lines = text.split(/\r?\n/);
  lines[task.lineNo] = formatTaskLine(task);
  write(p, lines.join("\n"));
  return task;
}

/**
 * Claim, renew, or take over a task.
 *
 * - Re-claiming your own live claim renews it. That is the heartbeat: a claim
 *   that keeps being renewed belongs to a live agent, and one that stops being
 *   renewed expires soon after its agent dies.
 * - A live claim held by someone else is refused with the evidence an agent
 *   needs to ask the user, unless `force` is set. Liveness cannot be known from
 *   files alone — a crashed agent and one still working in another window look
 *   identical — so the takeover decision belongs to the user or the clock.
 * - A DONE task is never reopened, forced or not.
 *
 * Returns the task, with `renewed` or `takenOverFrom` set when relevant.
 */
export function claim(root, slug, agent, ttlHours, { force = false } = {}) {
  const existing = findTask(root, slug);
  if (existing.state === "DONE") {
    throw new UserError(
      `\`${slug}\` is already DONE (${existing.log}). Add a new task instead of reopening this one.`,
    );
  }
  const at = nowIso();
  const held = existing.state === "IN_PROGRESS";

  if (held && existing.agent === agent && !isExpired(existing)) {
    const t = updateTask(root, slug, (x) => {
      x.seenAt = at;
      x.expiresAt = addHours(at, ttlHours);
    });
    return Object.assign(t, { renewed: true });
  }

  if (held && !isExpired(existing) && !force) {
    throw new UserError(liveClaimMessage(root, existing, agent));
  }

  const takenOverFrom = held && existing.agent !== agent ? { ...existing } : null;
  const t = updateTask(root, slug, (x) => {
    x.state = "IN_PROGRESS";
    x.agent = agent;
    x.claimedAt = at;
    x.seenAt = null;
    x.expiresAt = addHours(at, ttlHours);
    x.note = null;
    x.log = null;
  });
  return Object.assign(t, { takenOverFrom });
}

/** Renew `agent`'s claim on `slug` if it holds one. Silent otherwise. */
export function renewIfHeld(root, slug, agent, ttlHours) {
  const t = readTasks(root).find((x) => x.slug === slug);
  if (!t || t.state !== "IN_PROGRESS" || t.agent !== agent || isExpired(t)) return false;
  claim(root, slug, agent, ttlHours);
  return true;
}

/** When the holder was last known to be alive: its latest renewal, or the claim itself. */
export function lastSeen(task) {
  return task.seenAt || task.claimedAt;
}

/**
 * What an agent should show the user before taking over a live claim.
 * Evidence, not a verdict: relay cannot tell a dead agent from a busy one.
 */
export function claimEvidence(root, task) {
  const seen = Date.parse(lastSeen(task));
  const minutes = Number.isFinite(seen) ? Math.max(0, Math.round((Date.now() - seen) / 60000)) : null;
  const claimed = Date.parse(task.claimedAt);
  const logs = readHistory(root).filter(
    (e) =>
      (e.data.task || e.task) === task.slug &&
      (e.data.agent || e.agent) === task.agent &&
      (!Number.isFinite(claimed) || Date.parse(e.data.date) >= claimed),
  );
  return {
    minutesSinceSeen: minutes,
    logsSinceClaim: logs.map((e) => e.file),
    ...leftoverWork(root, task.claimedAt),
  };
}

/**
 * Where a previous agent's unlogged work is likely to be. With git, that is
 * the uncommitted changes. Without git there is nothing to diff, so it is the
 * files modified since the claim was made — by mtime, which is good enough to
 * tell the next agent where to look.
 */
export function leftoverWork(root, sinceIso) {
  if (isGitRepo(root)) return { git: true, label: "uncommitted changes", files: dirtyFiles(root) };
  const since = Date.parse(sinceIso);
  const files = Number.isFinite(since)
    ? scanTree(root)
        .files.filter((f) => f.mtime && f.mtime.getTime() >= since)
        .sort((a, b) => b.mtime - a.mtime)
        .map((f) => f.path)
    : [];
  return { git: false, label: "files modified since the claim", files };
}

export function describeFiles(files) {
  if (!files.length) return "none";
  return `${files.length} file(s), e.g. ${files.slice(0, 3).join(", ")}`;
}

function liveClaimMessage(root, task, agent) {
  const ev = claimEvidence(root, task);
  const ago = ev.minutesSinceSeen === null ? "unknown" : `${ev.minutesSinceSeen} min ago`;
  const row = (label, value) => `  ${`${label}:`.padEnd(32)}${value}`;
  return [
    `\`${task.slug}\` is claimed by ${task.agent} (expires ${task.expiresAt || "never"}).`,
    ``,
    `Evidence — relay cannot tell a stopped agent from a busy one, so show this to the user:`,
    row("last active", ago),
    row("logs since the claim", ev.logsSinceClaim.length ? ev.logsSinceClaim.join(", ") : "none"),
    row(ev.label, describeFiles(ev.files)),
    ``,
    `Take it over only if the user asked you to continue this task, or confirms`,
    `${task.agent} has stopped. Then:`,
    `  relay claim ${task.slug} --agent ${agent} --force`,
  ].join("\n");
}

export function isExpired(task, at = Date.now()) {
  if (task.state !== "IN_PROGRESS" || !task.expiresAt) return false;
  const t = Date.parse(task.expiresAt);
  return Number.isFinite(t) && t < at;
}

/** The first task any arriving agent could safely pick up. */
export function nextUnblocked(root) {
  const tasks = readTasks(root);
  return (
    tasks.find((t) => t.state === "TODO") ||
    tasks.find((t) => t.state === "IN_PROGRESS" && isExpired(t)) ||
    null
  );
}
