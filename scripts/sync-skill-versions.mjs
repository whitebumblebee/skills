#!/usr/bin/env node
// Copies the repo version from package.json into every skill's package.json,
// so a skill's own `version` command reports the release it came from.
// Runs as part of `npm run version`, right after `changeset version`.
// With --check it changes nothing and exits 1 if any version differs.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const check = process.argv.includes("--check");

const skillsDir = join(repo, "skills");
const manifests = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((group) =>
    readdirSync(join(skillsDir, group.name), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((skill) => join(skillsDir, group.name, skill.name, "package.json")),
  )
  .filter((file) => existsSync(file));

let stale = 0;
for (const file of manifests) {
  const source = readFileSync(file, "utf8");
  const current = JSON.parse(source).version;
  const rel = relative(repo, file);
  if (current === version) {
    console.log(`${rel} is ${version}`);
    continue;
  }
  if (check) {
    console.error(`${rel} is ${current}, package.json is ${version}. Run \`npm run version\`.`);
    stale += 1;
    continue;
  }
  // Rewrite only the version line, to keep the key order and the formatting.
  const updated = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (JSON.parse(updated).version !== version) {
    console.error(`Could not find a version field to replace in ${rel}.`);
    process.exit(1);
  }
  writeFileSync(file, updated);
  console.log(`${rel} ${current} -> ${version}`);
}
process.exit(stale ? 1 : 0);
