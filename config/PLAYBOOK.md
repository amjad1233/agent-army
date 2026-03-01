# Agent Swarm Playbook

> Exact prompts for starting, onboarding, and shutting down projects in the swarm.
> Copy-paste ready. No thinking required.

---

## 1. New Project — Start from Scratch

Run this in an empty directory or right after `git init`. Claude Code will scaffold everything.

```
You are setting up a new project for my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

DO THE FOLLOWING:

1. GITHUB SETUP:
   - Create a GitHub repo under amjad1233 (ask me for the repo name and description)
   - Create a GitHub Project (beta) board for it
   - Add fields: Priority (P0/P1/P2), Size (XS/S/M/L/XL) if not already present
   - Create labels: picked-up (yellow #fbca04), plus any phase labels I specify
   - Create a `picked-up` label: gh label create "picked-up" --description "Claimed by an agent — do not pick up" --color "fbca04"

2. CLAUDE.MD:
   - Ask me about the project (what it does, tech stack, key features)
   - Create a CLAUDE.md following the same structure as other projects in the swarm (see ~/.claude/swarm.md for examples)
   - Include: project overview, tech stack table, architecture, directory structure, data model, development rules, terminology, quick start
   - Include the Multi-Agent Workflow section from the swarm protocol

3. BACKLOG:
   - Ask me about the features/phases I want
   - Break them into GitHub issues with detailed descriptions, acceptance criteria, and checklists
   - Add all issues to the project board with appropriate Status, Priority, and Size
   - Set up iterations if I want them

4. SWARM REGISTRY:
   - Get all project field IDs using the GraphQL query from swarm.md
   - Add the project entry to ~/.claude/swarm.md under the Project Registry section
   - Include all field IDs, status option IDs, and labels

5. VERIFY:
   - Commit and push CLAUDE.md
   - Print a summary: repo URL, board URL, number of issues, and the launch command

After setup, I should be able to run:
~/.claude/swarm-launch.sh <project-path> <num-agents>
```

---

## 2. Existing Project — Onboard to the Swarm

Run this inside an existing project that already has code but isn't set up for the agent swarm yet.

```
You are onboarding an existing project into my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

This project already has code. DO NOT modify any existing code. Only add swarm infrastructure.

DO THE FOLLOWING:

1. UNDERSTAND THE PROJECT:
   - Read the codebase: check package.json/composer.json, look at src/app structure, README if it exists
   - Identify: tech stack, key directories, existing conventions, test setup, linting

2. GITHUB PROJECT BOARD:
   - Check if a GitHub Project board exists for this repo. If not, create one.
   - Add fields: Priority (P0/P1/P2), Size (XS/S/M/L/XL) if not present
   - Create the `picked-up` label if it doesn't exist:
     gh label create "picked-up" --description "Claimed by an agent — do not pick up" --color "fbca04"

3. CLAUDE.MD:
   - Create CLAUDE.md based on what you learned from the codebase
   - Follow the same structure as other swarm projects
   - Include accurate: tech stack, architecture, directory structure, existing conventions
   - Include the Multi-Agent Workflow section
   - DO NOT invent or assume features — only document what exists

4. BACKLOG:
   - Ask me what work I want done on this project
   - Create GitHub issues with descriptions and acceptance criteria
   - Add to project board with Priority, Size, and Status

5. SWARM REGISTRY:
   - Get all project field IDs
   - Add the project to ~/.claude/swarm.md under the Project Registry
   - Include all field IDs, status option IDs, and labels

6. VERIFY:
   - Commit CLAUDE.md (only file that should be new)
   - Print summary: repo URL, board URL, issues created, launch command

DO NOT:
- Modify any existing code
- Restructure the project
- Add dependencies
- Change the README
```

---

## 3. Shutting Down a Project

Run this when a project is complete or you want to remove it from the swarm.

```
You are shutting down a project from my agent swarm. Read ~/.claude/swarm.md for the full swarm protocol.

DO THE FOLLOWING:

1. CHECK FOR IN-FLIGHT WORK:
   - List all open issues with `picked-up` label — these have agents working on them
   - List all open PRs — these need to be merged or closed
   - If anything is in-flight, STOP and tell me. Do not proceed until I confirm.

2. CLEAN UP GITHUB:
   - Close all remaining open issues (or move to Done if completed)
   - Merge or close all open PRs
   - If I want a final release tag, create it:
     git tag -a v<version> -m "<message>" && git push origin v<version>

3. CLEAN UP WORKTREES:
   - List all git worktrees: git worktree list
   - Remove any leftover agent worktrees: git worktree remove <path>
   - Prune: git worktree prune

4. CLEAN UP BRANCHES:
   - List all remote branches: git branch -r
   - Delete merged feature branches (remote and local)
   - Keep only main

5. REMOVE FROM SWARM REGISTRY:
   - Remove the project entry from ~/.claude/swarm.md
   - (Optional) Archive the GitHub Project board — do not delete

6. ARCHIVE (optional):
   - If I want, archive the repo on GitHub: gh repo archive <repo> --yes
   - Move local directory to an archive location if I specify one

7. SUMMARY:
   - Print what was cleaned up: issues closed, PRs merged, branches deleted, worktrees removed
   - Confirm the project is no longer in the swarm registry

Ask me before doing anything destructive (deleting branches, archiving repo, closing issues).
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Launch swarm | `~/.claude/swarm-launch.sh <project-path> <num-agents>` |
| Launch specific issues | `~/.claude/swarm-launch.sh <project-path> 3 6 7 8` |
| Manual single agent | `cd <project> && claude --worktree -p "$(cat ~/.claude/agent-prompt.md | sed -n '/^## Prompt A/,/^---$/p')"` |
| View swarm config | `cat ~/.claude/swarm.md` |
| View agent prompts | `cat ~/.claude/agent-prompt.md` |
| View this playbook | `cat ~/.claude/PLAYBOOK.md` |
| Check agent logs | `tail -f ~/.claude/swarm-logs/agent-*.log` |
