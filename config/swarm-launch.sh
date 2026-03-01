#!/bin/bash
# ============================================================
# Agent Swarm Launcher
# Usage: ~/.claude/swarm-launch.sh <project-path> [num-agents] [issue-numbers...]
#
# Examples:
#   # Auto-pick 4 agents on BookBuddy
#   ~/.claude/swarm-launch.sh ~/sites/personal/luma 4
#
#   # Assign specific issues
#   ~/.claude/swarm-launch.sh ~/sites/personal/luma 3 6 7 8
#
#   # Auto-pick 2 agents on Tractivity
#   ~/.claude/swarm-launch.sh ~/sites/personal/tractivity 2
# ============================================================

set -e

PROJECT_PATH="${1:?Usage: swarm-launch.sh <project-path> [num-agents] [issue-numbers...]}"
NUM_AGENTS="${2:-3}"
shift 2 2>/dev/null || shift 1 2>/dev/null || true
ISSUE_NUMBERS=("$@")

STAGGER_SECONDS=8
SWARM_DIR="$HOME/.claude"
LOG_DIR="$SWARM_DIR/swarm-logs"
mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

AUTO_PROMPT='You are an autonomous development agent. Read ~/.claude/swarm.md for the full agent protocol and project registry. Read CLAUDE.md for project-specific rules. Find the next available issue from the current iteration that does NOT have the picked-up label, claim it, do the work, run quality checks, run cr review to self-review with CodeRabbit CLI before pushing, fix any issues found, create a PR, and stop. One issue only.'

SPECIFIC_PROMPT_TEMPLATE='You are an autonomous development agent. Read ~/.claude/swarm.md for the full agent protocol and project registry. Read CLAUDE.md for project-specific rules. Work on issue #ISSUE_NUM. Claim it, do the work, run quality checks, run cr review to self-review with CodeRabbit CLI before pushing, fix any issues found, create a PR, and stop. One issue only.'

echo "========================================"
echo "  Agent Swarm Launcher"
echo "========================================"
echo "  Project:  $PROJECT_PATH"
echo "  Agents:   $NUM_AGENTS"
if [ ${#ISSUE_NUMBERS[@]} -gt 0 ]; then
  echo "  Issues:   ${ISSUE_NUMBERS[*]}"
else
  echo "  Mode:     Auto-pick"
fi
echo "  Stagger:  ${STAGGER_SECONDS}s between agents"
echo "  Logs:     $LOG_DIR"
echo "========================================"
echo ""

cd "$PROJECT_PATH"

for i in $(seq 1 "$NUM_AGENTS"); do
  LOG_FILE="$LOG_DIR/agent-${TIMESTAMP}-${i}.log"

  if [ ${#ISSUE_NUMBERS[@]} -ge "$i" ]; then
    ISSUE_NUM="${ISSUE_NUMBERS[$((i-1))]}"
    PROMPT="${SPECIFIC_PROMPT_TEMPLATE//ISSUE_NUM/$ISSUE_NUM}"
    echo "[Agent $i] Assigned to issue #$ISSUE_NUM"
  else
    PROMPT="$AUTO_PROMPT"
    echo "[Agent $i] Auto-pick mode"
  fi

  echo "[Agent $i] Launching in worktree... (log: $LOG_FILE)"

  claude --worktree --dangerously-skip-permissions -p "$PROMPT" > "$LOG_FILE" 2>&1 &
  AGENT_PID=$!
  echo "[Agent $i] PID: $AGENT_PID"
  echo ""

  if [ "$i" -lt "$NUM_AGENTS" ]; then
    echo "  Waiting ${STAGGER_SECONDS}s before next agent..."
    sleep "$STAGGER_SECONDS"
  fi
done

echo "========================================"
echo "  All $NUM_AGENTS agents launched!"
echo "  Monitor logs: tail -f $LOG_DIR/agent-${TIMESTAMP}-*.log"
echo "========================================"
