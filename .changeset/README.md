# Changesets

Every change that users would notice gets a changeset: a small markdown file
here saying how big the change is and what it does. Add one with:

```bash
npx changeset
```

Pick `patch` for fixes, `minor` for new behaviour, `major` for anything that
breaks existing projects. The sentence you write becomes the changelog entry.

When changesets reach `main`, the Release workflow opens a "chore: version
skills" pull request. It bumps the version, writes `CHANGELOG.md`, and copies
the version into every skill's `package.json`. Merging that pull request tags
the release and creates its GitHub release.
