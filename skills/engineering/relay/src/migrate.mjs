/**
 * Migrate a legacy `history_<agent>_<NN>.md` layout into relay.
 *
 * The hard part is recovering *global* order. Legacy names only sequence within
 * one agent, so `history_cursor_28.md` and `history_warp_02.md` carry no
 * information about which came first. relay recovers it from, in order of
 * trustworthiness:
 *
 *   1. the legacy hand-written index, whose row order is chronological
 *   2. a date found inside the file
 *   3. filesystem mtime
 *
 * Dry-run is the default, and it prints the full mapping. Read it before
 * applying: order recovered from mtime is a guess, and you are the only one who
 * can confirm it.
 */
import fs from "node:fs";
import path from "node:path";
import {
  historyFilename,
  pad,
  parseFrontmatter,
  paths,
  read,
  serializeFrontmatter,
  slugify,
  UserError,
  write,
} from "./core.mjs";

const LEGACY = /^history_([a-z0-9-]+)_(\d+)\.md$/i;

export function planMigration(root, { from } = {}) {
  const sourceDir = path.resolve(root, from || ".");
  if (!fs.existsSync(sourceDir)) {
    throw new UserError(`Source directory not found: ${sourceDir}`);
  }

  const files = fs
    .readdirSync(sourceDir)
    .filter((n) => LEGACY.test(n))
    .sort();

  if (!files.length) {
    throw new UserError(
      `No legacy history_<agent>_<NN>.md files in ${sourceDir}.\n` +
        `Pass --from <dir> pointing at the directory that holds them.`,
    );
  }

  const legacyIndex = readLegacyIndex(sourceDir);
  const records = files.map((file) => {
    const m = LEGACY.exec(file);
    const full = path.join(sourceDir, file);
    const text = read(full) || "";
    const row = legacyIndex.get(file) || null;
    return {
      file,
      full,
      agent: m[1].toLowerCase(),
      legacyNo: Number(m[2]),
      indexPos: row ? row.pos : null,
      date: row?.date || dateFromText(text) || mtimeIso(full),
      dateSource: row?.date
        ? "legacy index"
        : dateFromText(text)
          ? "file contents"
          : "mtime (guess)",
      summary: row?.summary || firstMeaningfulLine(text) || "",
      indexed: Boolean(row),
      text,
    };
  });

  // Indexed rows keep the index's order. Un-indexed rows are placed by date.
  records.sort((a, b) => {
    if (a.indexPos !== null && b.indexPos !== null) return a.indexPos - b.indexPos;
    const byDate = String(a.date).localeCompare(String(b.date));
    if (byDate !== 0) return byDate;
    if (a.agent !== b.agent) return a.agent.localeCompare(b.agent);
    return a.legacyNo - b.legacyNo;
  });

  records.forEach((r, i) => {
    r.seq = i + 1;
    const derived = slugify(taskFromSummary(r.summary));
    // When no usable summary exists the derived slug just echoes the old
    // filename, which is noise. Fall back to the legacy number, which at least
    // stays traceable to the original.
    const echoesFilename = !derived || derived.replace(/-/g, "").includes(`history${r.agent}`);
    r.task = echoesFilename ? `legacy-${pad(r.legacyNo).slice(-2)}` : derived;
    r.target = historyFilename(r.seq, r.agent, r.task);
  });

  return {
    sourceDir,
    records,
    unindexed: records.filter((r) => !r.indexed).length,
    guessedDates: records.filter((r) => r.dateSource.startsWith("mtime")).length,
  };
}

export function applyMigration(root, plan) {
  const target = paths(root).historyDir;
  fs.mkdirSync(target, { recursive: true });
  const written = [];
  for (const r of plan.records) {
    const { data, body } = parseFrontmatter(r.text);
    const front = serializeFrontmatter({
      seq: r.seq,
      agent: r.agent,
      date: r.date,
      task: r.task,
      status: data.status || "done",
      summary: (r.summary || "Migrated from legacy log; summary not recovered.").trim(),
      next: data.next || "Migrated log — next action not recorded at the time.",
      supersedes: [],
      migrated_from: r.file,
    });
    write(path.join(target, r.target), `${front}\n\n${body || r.text}`);
    written.push(r.target);
  }
  return written;
}

/* --------------------------------------------------------------- helpers */

/** Row order in the legacy index is the best chronological signal available. */
function readLegacyIndex(dir) {
  const map = new Map();
  for (const name of ["history.md", "HISTORY.md"]) {
    const text = read(path.join(dir, name));
    if (!text) continue;
    let pos = 0;
    for (const line of text.split(/\r?\n/)) {
      const link = /\(([^)]*history_[a-z0-9-]+_\d+\.md)\)/i.exec(line);
      if (!link) continue;
      const file = path.basename(link[1]);
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      const date = cells.find((c) => /^\d{4}-\d{2}-\d{2}/.test(c)) || null;
      const summary = cells[cells.length - 1] || "";
      map.set(file, {
        pos: pos++,
        date,
        summary: summary.replace(/\[.*?\]\(.*?\)/g, "").trim(),
      });
    }
    if (map.size) break;
  }
  return map;
}

function dateFromText(text) {
  const { data } = parseFrontmatter(text);
  if (data.date) return String(data.date);
  const m = /\b(20\d{2}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?Z?)?/.exec(text);
  return m ? m[0] : null;
}

function mtimeIso(p) {
  try {
    return fs.statSync(p).mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch {
    return null;
  }
}

function firstMeaningfulLine(text) {
  const { body } = parseFrontmatter(text);
  for (const line of (body || text).split(/\r?\n/)) {
    const t = line.replace(/^#+\s*/, "").trim();
    if (t && !t.startsWith("<!--") && t.length > 12) return t.slice(0, 160);
  }
  return "";
}

function taskFromSummary(summary) {
  if (!summary) return "";
  return summary.split(/[.;:]/)[0].split(/\s+/).slice(0, 5).join(" ");
}
