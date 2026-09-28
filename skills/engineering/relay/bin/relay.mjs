#!/usr/bin/env node
/**
 * relay — hand work between AI coding agents without losing context.
 *
 * Every command is safe to run repeatedly. Nothing here commits, pushes,
 * deploys, or contacts the network.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import {
  UserError,
  findRoot,
  nowIso,
  paths,
  readConfig,
  readHistory,
  requireRoot,
} from "../src/core.mjs";
import { runInit, setupGuidePath } from "../src/init.mjs";
import { MODE_LABELS } from "../src/adopt.mjs";
import { bootstrapPending, commitDrift, createLog, writeIndex } from "../src/history.mjs";
import {
  claim,
  describeFiles,
  isExpired,
  lastSeen,
  leftoverWork,
  nextUnblocked,
  readTasks,
  renewIfHeld,
  updateTask,
} from "../src/tasks.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { compactDraft, finishCompact, startCompact } from "../src/compact.mjs";
import { applyMigration, planMigration } from "../src/migrate.mjs";
import { ALL_HARNESSES, HARNESSES } from "../src/harnesses.mjs";

const C = process.stdout.isTTY
  ? { dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { dim: "", red: "", yellow: "", green: "", bold: "", off: "" };

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=");
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

const list = (v) =>
  v === undefined || v === true ? [] : String(v).split(",").map((s) => s.trim()).filter(Boolean);

/* ------------------------------------------------------------- commands */

function cmdInit({ flags }) {
  const root = process.cwd();
  const harnesses = flags.all ? ALL_HARNESSES.filter((h) => h !== "generic") : list(flags.harness);
  const mode = typeof flags.mode === "string" ? flags.mode : undefined;
  const res = runInit(root, { harnesses, force: Boolean(flags.force), name: flags.name, mode });
  const rel = path.relative(root, setupGuidePath());
  const guide = rel.startsWith("..") ? setupGuidePath() : rel;

  console.log(`${C.green}relay initialised${C.off} — ${C.bold}${MODE_LABELS[res.mode]}${C.off}\n`);
  if (res.created.length) console.log(`Created:\n${res.created.map((f) => `  + ${f}`).join("\n")}`);
  if (res.updated.length)
    console.log(`\nAdded a relay section to (your own content is untouched):\n${res.updated.map((f) => `  ~ ${f}`).join("\n")}`);
  if (res.skipped.length)
    console.log(`\n${C.dim}Left alone (use --force to overwrite):${C.off}\n${res.skipped.map((f) => `  · ${f}`).join("\n")}`);
  console.log(`\nHarnesses wired: ${res.harnesses.map((h) => HARNESSES[h].label).join(", ")}`);

  console.log(`\n${C.bold}Next${C.off}`);
  if (res.legacy) {
    const where = res.legacy === "." ? "at the project root" : `in ${res.legacy}/`;
    console.log(`  Legacy history_<agent>_<NN>.md files found ${where}. No bootstrap entry was written —`);
    console.log(`  migrate them first, then finish setup:`);
    console.log(`    relay migrate --from ${res.legacy}          ${C.dim}# dry run; read it, then --apply${C.off}`);
  } else if (res.bootstrap) {
    console.log(`  Setup is not finished until an agent completes it with you.`);
    console.log(`  Tell your agent: "finish setting up relay". It will read the ${res.mode === "git" ? "git history and code" : "code"},`);
    console.log(`  ask you what it cannot work out, fill in PROJECT.md and tasks.md, and complete`);
    console.log(`  ${res.bootstrap}. \`relay doctor\` fails until then.`);
  } else if (res.mode === "new") {
    console.log(`  Tell your agent: "set up relay for this project". It will ask you about the`);
    console.log(`  product, suggest things like CI and deployment, ask how you want them`);
    console.log(`  prioritised, and fill in PROJECT.md and tasks.md from your answers.`);
  }
  console.log(`  ${C.dim}Agent instructions: ${guide}${C.off}`);
}

function cmdStatus() {
  const root = requireRoot();
  const tasks = readTasks(root);
  const entries = readHistory(root);
  const next = nextUnblocked(root);

  console.log(`${C.bold}${path.basename(root)}${C.off} ${C.dim}(${paths(root).dir.replace(root + "/", "")})${C.off}\n`);

  const counts = tasks.reduce((acc, t) => ({ ...acc, [t.state]: (acc[t.state] || 0) + 1 }), {});
  console.log(
    `Tasks: ${counts.TODO || 0} todo · ${counts.IN_PROGRESS || 0} in progress · ` +
      `${counts.BLOCKED || 0} blocked · ${counts.DONE || 0} done`,
  );
  console.log(`History: ${entries.length} entries`);
  const drift = commitDrift(root);
  if (!drift.git) {
    console.log(`${C.dim}No git repository — commit tracking is off.${C.off}`);
  } else if (drift.count) {
    const warn = drift.count >= readConfig(root).unloggedCommitsWarn;
    console.log(
      `${warn ? C.yellow : ""}Commits since ${drift.since}: ${drift.count}${warn ? C.off : ""}` +
        ` ${C.dim}— work that no handoff log explains${C.off}`,
    );
  }
  console.log("");

  const setup = bootstrapPending(entries);
  if (setup) {
    console.log(`${C.yellow}${C.bold}Setup is not finished${C.off}`);
    console.log(`  ${setup.file} still has placeholder fields. Complete adoption before other work —`);
    console.log(`  ${C.dim}see docs/setup.md in the relay skill.${C.off}\n`);
  }

  const draft = compactDraft(entries);
  if (draft) {
    console.log(`${C.yellow}${C.bold}Compaction in progress${C.off}`);
    console.log(`  Complete ${draft.file} with the user, then: relay compact --finish\n`);
  } else if (tasks.length && tasks.every((t) => t.state === "DONE") && entries.some((e) => !e.data.compact)) {
    console.log(`${C.green}${C.bold}Every task is done${C.off}`);
    console.log(`  Ask the user whether to compact this round into one summary: relay compact\n`);
  }

  const active = tasks.filter((t) => t.state === "IN_PROGRESS");
  if (active.length) {
    console.log(`${C.bold}Claimed${C.off}`);
    for (const t of active) {
      const stale = isExpired(t);
      console.log(
        `  ${stale ? `${C.red}✗${C.off}` : `${C.green}●${C.off}`} \`${t.slug}\` — ${t.agent} — last active ${lastSeen(t)}` +
          (t.expiresAt ? ` ${C.dim}(expires ${t.expiresAt}${stale ? " — EXPIRED" : ""})${C.off}` : ""),
      );
    }
    console.log("");
  }

  const blocked = tasks.filter((t) => t.state === "BLOCKED");
  if (blocked.length) {
    console.log(`${C.bold}Blocked${C.off}`);
    for (const t of blocked) console.log(`  ${C.yellow}!${C.off} \`${t.slug}\` — ${t.note || "no reason recorded"}`);
    console.log("");
  }

  if (entries.length) {
    console.log(`${C.bold}Last handoff${C.off}`);
    const last = entries[entries.length - 1];
    console.log(`  ${last.file}`);
    if (last.data.summary) console.log(`  ${C.dim}${last.data.summary}${C.off}`);
    if (last.data.next) console.log(`  ${C.bold}next:${C.off} ${last.data.next}`);
    console.log("");
  }

  console.log(`${C.bold}Next unblocked task${C.off}`);
  console.log(
    next
      ? `  \`${next.slug}\`${isExpired(next) ? ` ${C.dim}(expired claim by ${next.agent} — takeover allowed)${C.off}` : ""}\n` +
          `  ${C.dim}relay claim ${next.slug} --agent <you>${C.off}`
      : `  ${C.dim}nothing available — every task is done, blocked, or actively claimed${C.off}`,
  );
}

function cmdClaim({ positional, flags }) {
  const root = requireRoot();
  const slug = positional[0];
  if (!slug) throw new UserError("Usage: relay claim <task> --agent <name>");
  const agent = flags.agent;
  if (!agent) throw new UserError("--agent is required (e.g. --agent claude).");
  const ttl = Number(flags.ttl || readConfig(root).claimTtlHours);

  const t = claim(root, slug, agent, ttl, { force: Boolean(flags.force) });
  if (t.renewed) {
    console.log(`${C.green}Renewed${C.off} \`${t.slug}\` for ${t.agent} — expires ${t.expiresAt} ${C.dim}(${ttl}h)${C.off}`);
    return;
  }
  if (t.takenOverFrom) {
    const prev = t.takenOverFrom;
    const work = leftoverWork(root, prev.claimedAt);
    console.log(`${C.yellow}Took over${C.off} \`${slug}\` from ${prev.agent} (last active ${lastSeen(prev)}).`);
    console.log(`The previous agent may have left work but no log.`);
    console.log(`  ${work.label}: ${describeFiles(work.files)}`);
    console.log(
      `${C.dim}${work.git ? "Inspect `git status` and `git diff`" : "Read those files"} before editing, decide what to keep,`,
    );
    console.log(`and record the takeover and what you found in your log.${C.off}\n`);
  }
  console.log(`${C.green}Claimed${C.off} \`${t.slug}\` for ${t.agent}`);
  console.log(`  expires ${t.expiresAt} ${C.dim}(${ttl}h — renew by re-running this command)${C.off}`);
  console.log(`\n${C.dim}When done: relay log --agent ${agent} --task ${slug}${C.off}`);
}

function cmdBlock({ positional, flags }) {
  const root = requireRoot();
  const slug = positional[0];
  const reason = flags.reason || positional.slice(1).join(" ");
  if (!slug || !reason) throw new UserError('Usage: relay block <task> --reason "what is needed"');
  updateTask(root, slug, (t) => {
    t.state = "BLOCKED";
    t.note = reason;
    t.agent = null;
    t.claimedAt = null;
    t.expiresAt = null;
  });
  console.log(`${C.yellow}Blocked${C.off} \`${slug}\` — ${reason}`);
}

function cmdLog({ flags }) {
  const root = requireRoot();
  const res = createLog(root, {
    agent: flags.agent,
    task: flags.task,
    status: flags.status || "done",
    session: flags.session,
    summary: flags.summary,
    next: flags.next,
  });
  writeIndex(root);
  renewIfHeld(root, flags.task, flags.agent, readConfig(root).claimTtlHours);
  console.log(`${C.green}Created${C.off} ${path.relative(root, res.path)}  ${C.dim}(seq ${res.seq})${C.off}`);
  console.log(`${C.dim}history.md regenerated.${C.off}`);
  if (!flags.summary || !flags.next) {
    console.log(`\n${C.yellow}Fill in the file before handing off.${C.off}`);
    console.log(`  ${C.dim}\`summary:\` and \`next:\` must be real — \`relay doctor\` fails on the placeholders.${C.off}`);
  }
}

function cmdDone({ positional, flags }) {
  const root = requireRoot();
  const slug = positional[0];
  if (!slug) throw new UserError("Usage: relay done <task> --log <seq>");
  const entries = readHistory(root);
  let logSeq = flags.log;
  if (!logSeq) {
    const mine = entries.filter((e) => (e.data.task || e.task) === slug);
    if (!mine.length) {
      throw new UserError(
        `No history entry references \`${slug}\`.\n` +
          `Write one first: relay log --agent <you> --task ${slug}`,
      );
    }
    logSeq = mine[mine.length - 1].seq;
  }
  const n = Number(String(logSeq).replace(/\D/g, ""));
  if (!entries.some((e) => e.seq === n)) throw new UserError(`No history entry with sequence ${n}.`);
  updateTask(root, slug, (t) => {
    t.state = "DONE";
    t.log = String(n).padStart(4, "0");
    t.agent = null;
    t.claimedAt = null;
    t.expiresAt = null;
  });
  console.log(`${C.green}Done${C.off} \`${slug}\` — log ${String(n).padStart(4, "0")}`);
}

function cmdCompact({ flags }) {
  const root = requireRoot();
  if (!flags.finish) {
    const res = startCompact(root);
    console.log(`${C.green}Drafted${C.off} .relay/history/${res.file} ${C.dim}(covers ${res.covers} log(s))${C.off}\n`);
    console.log(`Fill it in with the user — "What is true now" first, then the record.`);
    console.log(`Move lasting rules into PROJECT.md. Then: relay compact --finish`);
    return 0;
  }
  const res = finishCompact(root, { confirmDelete: Boolean(flags["confirm-delete"]) });
  console.log(`${C.green}Compacted${C.off} ${res.deleted} log(s) into .relay/history/${res.file}`);
  if (res.removedTasks.length) console.log(`  Removed finished tasks: ${res.removedTasks.map((s) => `\`${s}\``).join(", ")}`);
  console.log(
    res.recoverFrom
      ? `  ${C.dim}The deleted logs can be restored from commit ${res.recoverFrom}.${C.off}`
      : `  ${C.dim}The deleted logs are gone; the summary is the record.${C.off}`,
  );
  console.log(`\nThe next log will be 0002.`);
  return 0;
}

function cmdIndex() {
  const root = requireRoot();
  writeIndex(root);
  const n = readHistory(root).length;
  console.log(`${C.green}Regenerated${C.off} ${path.relative(root, paths(root).index)} from ${n} entries.`);
}

function cmdDoctor({ flags }) {
  const root = requireRoot();
  const res = runDoctor(root, { strict: Boolean(flags.strict) });
  const icon = { error: `${C.red}✗${C.off}`, warn: `${C.yellow}!${C.off}` };
  if (!res.findings.length) {
    console.log(`${C.green}✓ All checks passed.${C.off} ${C.dim}${res.stats.entries} history entries, ${res.stats.tasks} tasks.${C.off}`);
    return 0;
  }
  for (const f of res.findings) {
    console.log(`${icon[f.level]} ${C.bold}${f.code}${C.off} ${f.message}`);
    if (f.hint) console.log(`  ${C.dim}${f.hint}${C.off}`);
  }
  console.log(`\n${res.counts.error} error(s), ${res.counts.warn} warning(s).`);
  return res.ok ? 0 : 1;
}

function cmdMigrate({ flags }) {
  const root = findRoot() || process.cwd();
  const plan = planMigration(root, { from: flags.from });
  console.log(`${C.bold}Migration plan${C.off} — ${plan.sourceDir}\n`);
  console.log(`${"seq".padEnd(5)}${"from".padEnd(28)}${"to".padEnd(44)}date / source`);
  console.log("-".repeat(110));
  for (const r of plan.records) {
    console.log(
      `${String(r.seq).padStart(4, "0")} ${r.file.padEnd(27)} ${r.target.padEnd(43)} ` +
        `${String(r.date).slice(0, 10)} ${C.dim}${r.dateSource}${C.off}`,
    );
  }
  console.log(`\n${plan.records.length} files.`);
  if (plan.unindexed) console.log(`${C.yellow}${plan.unindexed}${C.off} were missing from the legacy index.`);
  if (plan.guessedDates)
    console.log(`${C.yellow}${plan.guessedDates}${C.off} ordered by mtime — verify these before trusting the order.`);

  if (!flags.apply) {
    console.log(`\n${C.dim}Dry run. Nothing written. Re-run with --apply to perform it.${C.off}`);
    return 0;
  }
  if (!findRoot()) throw new UserError("Run `relay init` before `relay migrate --apply`.");
  const written = applyMigration(root, plan);
  writeIndex(root);
  console.log(`\n${C.green}Wrote ${written.length} files${C.off} to ${path.relative(root, paths(root).historyDir)} and regenerated history.md.`);
  console.log(`${C.dim}Originals were not deleted. Review, then remove them yourself.${C.off}`);
  return 0;
}

function cmdHarness({ positional, flags }) {
  const root = requireRoot();
  if (!positional.length) {
    for (const [id, h] of Object.entries(HARNESSES)) {
      console.log(`${id.padEnd(14)} ${h.label.padEnd(18)} ${C.dim}${h.confidence}${C.off}`);
      console.log(`  ${C.dim}${h.files.join(", ")} — ${h.note}${C.off}`);
    }
    return 0;
  }
  const res = runInit(root, { harnesses: positional, force: Boolean(flags.force) });
  const added = [...res.created, ...res.updated].filter((f) => !f.startsWith(".relay"));
  console.log(added.length ? `${C.green}Added:${C.off}\n${added.map((f) => `  + ${f}`).join("\n")}` : `${C.dim}Nothing new; all pointer files already exist.${C.off}`);
  return 0;
}

function cmdVersion() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
  console.log(`relay ${pkg.version}`);
}

const HELP = `relay — hand work between AI coding agents without losing context

USAGE
  relay <command> [options]

SETUP
  init                         Create .relay/ and harness pointer files
    --harness <a,b>              Comma-separated harness ids (see: relay harness)
    --all                        Wire every known harness
    --name <name>                Project name (default: directory name)
    --mode new|git|code          Override detection: new project, existing with
                                 git history, existing without git history
    --force                      Overwrite relay-owned files
  harness [id...]              List known harnesses, or add pointers for some

DAILY USE
  status                       Where things stand and what to pick up next
  claim <task> --agent <name>  Claim one task; re-run to renew your own claim
    --ttl <hours>                Override the claim expiry
    --force                      Take over someone else's claim (expired, or
                                 the user asked you to continue it)
  block <task> --reason "..."  Mark a task blocked with what is needed
  log --agent <n> --task <t>   Create the next history entry
    --status done|partial|blocked
    --summary "..."  --next "..."  --session <id>
  done <task> [--log <seq>]    Mark done, citing a history entry

INTEGRITY
  index                        Regenerate history.md from .relay/history/
  doctor [--strict]            Check everything; exit 1 on errors
  compact                      Draft one summary of this round's logs
    --finish                     Replace the round's logs with the summary
    --confirm-delete             Allow it when git cannot restore the logs

  version, help

Docs: https://github.com/whitebumblebee/skills/tree/main/skills/engineering/relay
`;

const COMMANDS = {
  init: cmdInit,
  status: cmdStatus,
  claim: cmdClaim,
  block: cmdBlock,
  log: cmdLog,
  done: cmdDone,
  index: cmdIndex,
  compact: cmdCompact,
  doctor: cmdDoctor,
  migrate: cmdMigrate,
  harness: cmdHarness,
  version: cmdVersion,
};

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return 0;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(HELP);
    return 1;
  }
  return fn(parseArgs(rest)) || 0;
}

try {
  process.exit(main());
} catch (err) {
  if (err instanceof UserError) {
    console.error(`${C.red}${err.message}${C.off}`);
    process.exit(1);
  }
  throw err;
}

export { nowIso };
