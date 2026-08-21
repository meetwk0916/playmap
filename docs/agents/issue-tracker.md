# Issue tracker: GitHub

Issues and specs live in `meetwk0916/playmap`. Use `gh` inside this clone so the remote is inferred automatically.

- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open`
- Create: `gh issue create --title "..." --body "..."`
- Comment/label/close: use the corresponding `gh issue` command.
- Labels must follow `docs/agents/triage-labels.md`; do not create unconfigured labels without approval.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

If a bare `#42` is ambiguous, try `gh pr view 42` and then `gh issue view 42`.
