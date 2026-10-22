# Issue tracker: GitHub

Issues and specs live in GitHub Issues for `aniketmandloi/cart-campuss`.
Use the `gh` CLI from this repo, or pass `--repo aniketmandloi/cart-campuss`.

## Conventions

- Create: `gh issue create --title "..." --body-file <file>`.
  Write multiline bodies to a temporary file.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels`.
  Filter with `--label` and `--state` as needed.
- Comment: `gh issue comment <number> --body-file <file>`.
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or
  `gh issue edit <number> --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child tickets: link to the map using GitHub sub-issues. If unavailable,
  use a task list in the map and `Part of #<map>` in each child.
  Label tickets `wayfinder:<type>` for research, prototype, grilling, or task.
- Blocking: use GitHub issue dependencies with numeric database IDs.
  If unavailable, record `Blocked by: #<number>` in the child.
- Frontier: choose the first open, unassigned child in map order
  whose blockers are all closed.
- Claim: `gh issue edit <number> --add-assignee @me`.
- Resolve: comment with the result, close the child, and append a
  summary and link to the map's Decisions-so-far.
