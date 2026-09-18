# skills

[![skills.sh](https://skills.sh/b/whitebumblebee/skills)](https://skills.sh/whitebumblebee/skills)

Agent skills for coding harnesses — Claude Code, Cursor, Codex, Warp, Kiro,
Cline, opencode and anything else that reads `AGENTS.md`.

```bash
npx skills@latest add whitebumblebee/skills
```

That installs every skill in this repo. To install just one:

```bash
npx skills@latest add whitebumblebee/skills@relay
```

Add `--global` to install into `~/.agents/skills/` so the skills are available
in every project rather than only the current one.

## The skills

Skills are **model-invoked** unless noted: the agent loads them on its own when
the situation in the `description` matches, without you asking.

| Skill | What it does |
| --- | --- |
| [**relay**](skills/engineering/relay) | Hand work between AI agents without losing context. Sequenced handoff logs, claimed tasks, a generated history index, and a `doctor` command that verifies the whole surface. Ships a zero-dependency Node CLI alongside the protocol. |

## How installation works

The `skills` CLI copies each skill directory into `.agents/skills/<name>/` and
symlinks it from every agent directory it finds (`.claude/skills/`,
`.cursor/skills/`, and so on). One canonical copy, no drift between tools —
which is the same principle relay itself is built on.

Skills that ship executable code, like relay, keep it inside their own
directory, so installing the skill installs the tool. There is nothing to
`npm install`.

## License

MIT — see [LICENSE](LICENSE). Every skill here is MIT licensed, including the
copy that lands in your repo, so it is safe to use at work.
