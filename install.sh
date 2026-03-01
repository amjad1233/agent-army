#!/bin/bash
# ============================================================
# Installs AgentArmy config files to ~/.claude/
#
# Run this after cloning or after editing config in the repo.
# Source of truth: this repo. ~/.claude/ gets the copies.
#
# Usage: ./install.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/config"
TARGET_DIR="$HOME/.claude"

echo "Installing AgentArmy config → ~/.claude/"
echo ""

cp "$CONFIG_DIR/swarm.md"         "$TARGET_DIR/swarm.md"
cp "$CONFIG_DIR/agent-prompt.md"  "$TARGET_DIR/agent-prompt.md"
cp "$CONFIG_DIR/PLAYBOOK.md"      "$TARGET_DIR/PLAYBOOK.md"
cp "$CONFIG_DIR/swarm-vision.md"  "$TARGET_DIR/swarm-vision.md"
cp "$CONFIG_DIR/swarm-launch.sh"  "$TARGET_DIR/swarm-launch.sh"
chmod +x "$TARGET_DIR/swarm-launch.sh"

echo "  swarm.md          ✓"
echo "  agent-prompt.md   ✓"
echo "  PLAYBOOK.md       ✓"
echo "  swarm-vision.md   ✓"
echo "  swarm-launch.sh   ✓"
echo ""
echo "Done. ~/.claude/ is up to date."
