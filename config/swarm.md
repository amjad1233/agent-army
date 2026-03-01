# Agent Swarm Configuration

> Global rules for autonomous Claude Code agents working across all projects.
> This file lives at `~/.claude/swarm.md` and is referenced by agent prompts.

---

## GitHub Owner

- **Username:** `amjad1233`
- **Auth:** `gh` CLI authenticated with `read:project` + `project` scopes

---

## Project Registry

Each project has a GitHub Projects (beta) board that serves as the single source of truth for work.

### BookBuddy

| Key | Value |
|-----|-------|
| Repo | `amjad1233/luma` |
| Local path | `/Users/amjad/sites/personal/luma` |
| Project board | https://github.com/users/amjad1233/projects/2 |
| Project ID | `PVT_kwHOAAoWms4BQYpB` |
| Project number | `2` |
| CLAUDE.md | Yes — read it before starting any work |
| CodeRabbit | Enabled |
| Status field | `PVTSSF_lAHOAAoWms4BQYpBzg-hU_A` |
| Status: Backlog | `f75ad846` |
| Status: Ready | `e18bf179` |
| Status: In progress | `47fc9ee4` |
| Status: In review | `aba860b9` |
| Status: Done | `98236657` |
| Priority field | `PVTSSF_lAHOAAoWms4BQYpBzg-hVHg` |
| Size field | `PVTSSF_lAHOAAoWms4BQYpBzg-hVHk` |
| Iteration field | `PVTIF_lAHOAAoWms4BQYpBzg-hVHs` |
| Labels | `phase-0`, `phase-1`, `phase-2`, `iteration-1`, `iteration-2`, `picked-up` |

### Tractivity

| Key | Value |
|-----|-------|
| Repo | `amjad1233/tractivity` |
| Local path | `/Users/amjad/sites/personal/tractivity` |
| Project board | https://github.com/users/amjad1233/projects/1 |
| Project ID | `PVT_kwHOAAoWms4Azc8R` |
| Project number | `1` |
| CLAUDE.md | Check repo for project-specific rules |
| CodeRabbit | Enabled |
| Status field | `PVTSSF_lAHOAAoWms4Azc8RzgpPe3k` |
| Status: Backlog | `f75ad846` |
| Status: Ready | `61e4505c` |
| Status: In progress | `47fc9ee4` |
| Status: In review | `df73e18b` |
| Status: Done | `98236657` |
| Priority field | `PVTSSF_lAHOAAoWms4Azc8RzgpPe4k` |
| Size field | `PVTSSF_lAHOAAoWms4Azc8RzgpPe4o` |
| Labels | `picked-up` (create iteration/phase labels per project as needed) |

### AgentArmy

| Key | Value |
|-----|-------|
| Repo | `amjad1233/agent-army` |
| Local path | `/Users/amjad/sites/personal/agent-army` |
| Project board | https://github.com/users/amjad1233/projects/3 |
| Project ID | `PVT_kwHOAAoWms4BQdEt` |
| Project number | `3` |
| CLAUDE.md | Yes — read it before starting any work |
| CodeRabbit | Enabled |
| Status field | `PVTSSF_lAHOAAoWms4BQdEtzg-kZ90` |
| Status: Todo | `f75ad846` |
| Status: In Progress | `47fc9ee4` |
| Status: Done | `98236657` |
| Priority field | `PVTSSF_lAHOAAoWms4BQdEtzg-kaBk` |
| Size field | `PVTSSF_lAHOAAoWms4BQdEtzg-kaBo` |
| Labels | `phase-1`, `phase-2`, `phase-3`, `picked-up` |

<!-- ADD NEW PROJECTS HERE — copy the table above and fill in the values -->
<!-- To get field IDs for a new project:
     gh api graphql -f query='{ node(id: "<PROJECT_ID>") { ... on ProjectV2 { fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2IterationField { id name configuration { iterations { id title } } } ... on ProjectV2Field { id name } } } } } }'
-->

---

## Agent Protocol

Every agent follows this exact sequence. No exceptions.

### Step 1: Orient

```
1. Read the project's CLAUDE.md for full context
2. Identify which project you are working on from the registry above
3. Check for open PRs to avoid file conflicts:
   gh pr list --repo <OWNER>/<REPO> --state open --json number,title,headRefName
```

### Step 2: Claim Work

**If a specific issue number was provided:**
```bash
# Verify it's not already picked up
LABELS=$(gh issue view <NUMBER> --repo <OWNER>/<REPO> --json labels -q '.labels[].name')
if echo "$LABELS" | grep -q "picked-up"; then
  echo "STOP: Issue #<NUMBER> is already claimed by another agent."
  exit 1
fi

# Claim it
gh issue edit <NUMBER> --repo <OWNER>/<REPO> --add-label "picked-up"
```

**If no issue specified (auto-pick):**
```bash
# Find the next available issue from the current iteration
# Pick the LOWEST numbered open issue that:
#   - has the current iteration label (e.g. iteration-1)
#   - does NOT have the picked-up label
#   - is in Ready status on the board

gh issue list --repo <OWNER>/<REPO> \
  --label "<current-iteration-label>" \
  --state open \
  --json number,title,labels \
  | python3 -c "
import json, sys
issues = json.load(sys.stdin)
available = [i for i in issues if not any(l['name'] == 'picked-up' for l in i['labels'])]
available.sort(key=lambda x: x['number'])
if available:
    print(f'Picking #{available[0][\"number\"]}: {available[0][\"title\"]}')
else:
    print('NO AVAILABLE ISSUES — all picked up or iteration empty')
"

# Then claim it
gh issue edit <NUMBER> --repo <OWNER>/<REPO> --add-label "picked-up"
```

### Step 3: Move to In Progress

```bash
# Get the project item ID for this issue
ITEM_ID=$(gh project item-list <PROJECT_NUMBER> --owner amjad1233 --format json \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for item in data['items']:
    if item.get('content', {}).get('number') == <NUMBER>:
        print(item['id'])
        break
")

# Move to In Progress
gh project item-edit --project-id "<PROJECT_ID>" \
  --id "$ITEM_ID" \
  --field-id "<STATUS_FIELD_ID>" \
  --single-select-option-id "<IN_PROGRESS_OPTION_ID>"
```

### Step 4: Check Dependencies

Before writing code, check if this issue depends on another:

```bash
# Read the issue body for references to other issues
gh issue view <NUMBER> --repo <OWNER>/<REPO> --json body,title

# Check if any referenced issues are still open / in progress
# If a dependency is still "In progress" by another agent:
#   → WAIT — poll every 60 seconds until the dependency moves to "In review" or "Done"
#   → Then create your branch FROM that dependency's branch (not main)
#
# If a dependency has an open PR (In review):
#   → Create your branch FROM that PR's branch
#   → Note this in your PR description: "Based on #<dep-number>"
#
# If a dependency is Done and merged:
#   → Create your branch from main (pull latest first)
```

**Dependency detection keywords in issue body:**
- "Depends on #X", "After #X", "Blocked by #X", "Requires #X"
- "fields listed in issue 0.3" or similar cross-references

### Step 5: Create Branch & Work

```bash
# Pull latest main
git checkout main && git pull origin main

# If depending on an unmerged PR branch:
# git checkout <dependency-branch> && git pull

# Create feature branch
git checkout -b feature/<issue-short-name>

# --- DO THE WORK ---
# Follow ALL rules in the project's CLAUDE.md
# One issue only — do not scope-creep
```

### Step 6: Pre-commit Checks

Run all quality checks before committing. These vary by project — check CLAUDE.md.

Common patterns:
```bash
# PHP/Laravel projects
./vendor/bin/pint          # Code style
php artisan test           # Tests

# Node/TypeScript projects
npm run lint               # Linting
npm run test               # Tests
npm run build              # Build check
```

### Step 7: Commit & Push

```bash
# Stage changes
git add <specific-files>

# Commit with issue reference
git commit -m "feat: <description> (#<issue-number>)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Step 8: CodeRabbit Self-Review (BEFORE pushing)

**Do NOT push yet.** Run CodeRabbit CLI to review your own changes first.

```bash
# Review the current changes against the base branch
cr review

# If CodeRabbit reports issues:
#   1. Read each finding carefully
#   2. Fix the code
#   3. Run quality checks again (pint, tests)
#   4. Amend your commit: git add <files> && git commit --amend --no-edit
#   5. Run `cr review` again
#   6. Repeat until CodeRabbit is satisfied or only minor/stylistic issues remain
#
# Only push once cr review comes back clean or with only minor findings
```

**Why:** Catching issues locally is 10x faster than the round-trip of push → PR → CodeRabbit GitHub review → copy comments → fix → push again.

### Step 9: Rebase on Main & Push

Before pushing, ensure your branch is up to date with main. Other agents may have merged PRs while you were working.

```bash
# Fetch latest
git fetch origin main

# Check if main has moved ahead
if [ "$(git rev-list HEAD..origin/main --count)" -gt 0 ]; then
  echo "Main has new commits — rebasing..."
  git rebase origin/main

  # If rebase conflicts:
  #   → STOP. Do NOT resolve blindly.
  #   → Run: git rebase --abort
  #   → Report the conflict to the user and exit.

  # After successful rebase, re-run quality checks
  # (pint, tests, cr review)
fi

# Push
git push -u origin feature/<branch-name>
```

### Step 10: Create PR & Request Review

```bash
gh pr create --repo <OWNER>/<REPO> \
  --title "<Short description> (#<issue-number>)" \
  --body "$(cat <<'EOF'
Closes #<issue-number>

## Summary
- <what changed, bullet points>

## CodeRabbit pre-push review
- [x] Ran `cr review` locally — issues addressed before push

## Test plan
- [ ] <how to verify this works>

## Dependencies
- <list any PRs this is based on, or "None">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
🐰 CodeRabbit will auto-review this PR
EOF
)" \
  --reviewer amjad1233
```

### Step 11: Move to In Review

```bash
gh project item-edit --project-id "<PROJECT_ID>" \
  --id "$ITEM_ID" \
  --field-id "<STATUS_FIELD_ID>" \
  --single-select-option-id "<IN_REVIEW_OPTION_ID>"
```

### Step 12: Stop

**Do NOT pick up another issue.** One issue per agent session. Exit cleanly.

---

## Git Rules

1. **Never commit directly to `main`** — always feature branch
2. **Never force-push** — not to any branch, ever
3. **Branch naming:** `feature/<short-description>` or `fix/<short-description>`
4. **One branch per issue** — never mix issues in a single branch
5. **Commit messages:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:` prefixes
6. **Always include issue reference** in commit message: `(#<number>)`
7. **Always include Co-Authored-By** for Claude in commit messages
8. **Pull main before branching** — always start from latest
9. **If merge conflict:** STOP. Do not resolve blindly. Explain the conflict and wait for human input
10. **If depending on another agent's unmerged branch:** branch from their branch, note it in your PR

---

## Dependency Handling

Agents work concurrently. Some issues depend on others. Here's how to handle it:

| Dependency status | What to do |
|-------------------|------------|
| **Done** (merged to main) | Branch from `main` after `git pull` |
| **In review** (PR open, not merged) | Branch from that PR's branch. Note `Based on #X` in your PR |
| **In progress** (another agent working) | Wait. Poll the issue status every 60s. Start only after it moves to In review or Done |
| **Ready / Backlog** (not started) | This is a blocker. Do NOT start. Report to user that the dependency hasn't been picked up |

### Polling for dependency completion

```bash
while true; do
  STATUS=$(gh issue view <DEP_NUMBER> --repo <OWNER>/<REPO> --json labels -q '.labels[].name' | tr '\n' ',')
  # Check if the dependency's PR exists
  PR_COUNT=$(gh pr list --repo <OWNER>/<REPO> --search "<DEP_NUMBER> in:title" --json number -q 'length')
  if [ "$PR_COUNT" -gt 0 ]; then
    echo "Dependency #<DEP_NUMBER> has a PR — safe to proceed"
    DEP_BRANCH=$(gh pr list --repo <OWNER>/<REPO> --search "<DEP_NUMBER> in:title" --json headRefName -q '.[0].headRefName')
    echo "Branch from: $DEP_BRANCH"
    break
  fi
  echo "Waiting for dependency #<DEP_NUMBER>... checking again in 60s"
  sleep 60
done
```

---

## CodeRabbit Integration

[CodeRabbit](https://coderabbit.ai) is enabled on all repos. It auto-reviews every PR.

**What this means for agents:**
- After creating a PR, CodeRabbit will post review comments automatically
- The human reviewer (amjad1233) will review both the code AND CodeRabbit's feedback
- Agents do NOT need to respond to CodeRabbit comments — the human handles that
- If CodeRabbit flags something critical, the human may request changes on the PR

**What this means for the human:**
- Every PR gets two reviews: CodeRabbit (automated) + your manual review
- Check CodeRabbit's summary comment first for a quick overview
- CodeRabbit catches style issues, bugs, and security concerns
- You focus on architecture, logic, and product correctness

---

## Adding a New Project

To add a new project to the swarm:

1. Create a GitHub Project (beta) board for the repo
2. Add standard columns: Backlog, Ready, In progress, In review, Done
3. Add fields: Priority (P0/P1/P2), Size (XS/S/M/L/XL)
4. Create a `picked-up` label on the repo:
   ```bash
   gh label create "picked-up" --description "Claimed by an agent — do not pick up" --color "fbca04" --repo amjad1233/<REPO>
   ```
5. Get the project field IDs:
   ```bash
   gh api graphql -f query='{ node(id: "<PROJECT_ID>") { ... on ProjectV2 { fields(first: 20) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2IterationField { id name configuration { iterations { id title } } } ... on ProjectV2Field { id name } } } } } }'
   ```
6. Add the project entry to the registry table above
7. Create a `CLAUDE.md` in the repo with project-specific rules
8. Enable CodeRabbit on the repo
