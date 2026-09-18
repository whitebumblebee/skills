/**
 * tasks.md is the single authoritative tracker.
 *
 * One file, one format, one owner per task. Plans, designs and roadmaps may
 * exist alongside it, but they are subordinate: if a plan and tasks.md
 * disagree, tasks.md wins. The most common failure in multi-agent projects is
 * several half-maintained trackers with no declared precedence, and the cost
 * lands on whichever agent arrives last.
 */
import { UserError, addHours, nowIso, paths, read, write } from "./core.mjs";

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
      expiresAt: null,
      note: null,
      log: null,
    };
    if (state === "IN_PROGRESS") {
      task.agent = parts[0] || null;
      task.claimedAt = parts[1] || null;
      const exp = parts.find((p) => p.startsWith("expires "));
      task.expiresAt = exp ? exp.slice("expires ".length).trim() : null;
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
    if (task.expiresAt) line += ` — expires ${task.expiresAt}`;
  } else if (task.state === "BLOCKED" && task.note) {
    line += ` — ${task.note}`;
  } else if (task.state === "DONE" && task.log) {
    line += ` — ${task.log}`;
  }
  return line;
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

export function claim(root, slug, agent, ttlHours) {
  const existing = findTask(root, slug);
  if (existing.state === "IN_PROGRESS" && !isExpired(existing)) {
    throw new UserError(
      `\`${slug}\` is already claimed by ${existing.agent} at ${existing.claimedAt}` +
        (existing.expiresAt ? ` (expires ${existing.expiresAt}).` : ".") +
        `\nTake it over only if the user reassigns it, or after it expires.` +
        `\nThen: relay claim ${slug} --agent ${agent} --force`,
    );
  }
  if (existing.state === "DONE") {
    throw new UserError(
      `\`${slug}\` is already DONE (${existing.log}). Add a new task instead of reopening this one.`,
    );
  }
  const at = nowIso();
  return updateTask(root, slug, (t) => {
    t.state = "IN_PROGRESS";
    t.agent = agent;
    t.claimedAt = at;
    t.expiresAt = addHours(at, ttlHours);
    t.note = null;
    t.log = null;
  });
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
