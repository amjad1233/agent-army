import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import * as pty from 'node-pty';
import {
  createSession,
  updateSessionStatus,
  getSession,
  getActiveSessions,
  getProject,
} from './Database.js';

const MAX_LOG_BYTES = 100 * 1024; // ~100KB circular buffer per agent

class AgentManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<number, { pty: pty.IPty, log: string[], logBytes: number }>} */
    this.agents = new Map();
  }

  /**
   * Launch a new Claude Code agent.
   * @param {number} projectId
   * @param {number|null} issueNumber
   * @param {string|null} issueTitle
   * @returns {object} session record
   */
  launch(projectId, issueNumber = null, issueTitle = null) {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Validate project path exists
    if (!existsSync(project.local_path)) {
      throw new Error(`Project path does not exist: ${project.local_path}`);
    }

    // Verify claude CLI is available
    try {
      execFileSync('which', ['claude'], { stdio: 'pipe' });
    } catch {
      throw new Error('claude CLI not found in PATH. Install it first.');
    }

    // Build the prompt
    let prompt = `You are an autonomous agent working on the ${project.name} project.`;
    if (issueNumber) {
      prompt += ` Work on issue #${issueNumber}`;
      if (issueTitle) prompt += `: ${issueTitle}`;
      prompt += '.';
    }
    prompt += ' Follow the agent protocol in ~/.claude/swarm.md and the project CLAUDE.md.';

    // Generate a Claude session ID so we can resume later
    const claudeSessionId = randomUUID();
    const args = ['--dangerously-skip-permissions', '--session-id', claudeSessionId];

    // Spawn in interactive mode so we get streaming output and can send messages
    const proc = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: project.local_path,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    // Send the initial prompt after user accepts the permissions prompt.
    // We watch for the ready signal (the ">" input prompt) before sending.
    let promptSent = false;
    proc.onData(function sendPromptOnReady(data) {
      if (!promptSent && data.includes('>')) {
        promptSent = true;
        // Small delay to let the UI fully render
        setTimeout(() => {
          proc.write(prompt);
          setTimeout(() => proc.write('\r'), 100);
        }, 500);
      }
    });

    // Create DB session
    const sessionId = createSession({
      projectId,
      issueNumber,
      issueTitle,
      pid: proc.pid,
      worktreePath: null,
      branchName: null,
      claudeSessionId,
    });

    // Set up log buffer
    const agent = { pty: proc, log: [], logBytes: 0 };
    this.agents.set(sessionId, agent);

    // Stream data
    proc.onData((data) => {
      // Append to circular log
      agent.log.push(data);
      agent.logBytes += data.length;

      // Trim from front if over budget
      while (agent.logBytes > MAX_LOG_BYTES && agent.log.length > 1) {
        const removed = agent.log.shift();
        agent.logBytes -= removed.length;
      }

      this.emit('agent:output', { sessionId, data });
    });

    proc.onExit(({ exitCode }) => {
      const status = exitCode === 0 ? 'completed' : 'failed';
      updateSessionStatus(sessionId, status);
      this.agents.delete(sessionId);
      this.emit('agent:status', { sessionId, status, exitCode });
    });

    this.emit('agent:launched', { sessionId, projectId, issueNumber });

    const session = getSession(sessionId);
    return session;
  }

  /**
   * Send a message to a running agent's stdin.
   */
  sendMessage(sessionId, message) {
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`Agent ${sessionId} is not running`);
    // Write text first, then send Enter after a delay so the TUI
    // has time to process the characters into its input buffer
    agent.pty.write(message);
    setTimeout(() => agent.pty.write('\r'), 100);
  }

  /**
   * Send raw input (keypresses) to a running agent's stdin.
   */
  sendRawInput(sessionId, data) {
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`Agent ${sessionId} is not running`);
    agent.pty.write(data);
  }

  /**
   * Stop a running agent.
   */
  stop(sessionId) {
    const agent = this.agents.get(sessionId);
    if (!agent) throw new Error(`Agent ${sessionId} is not running`);

    // Try graceful kill first
    agent.pty.kill('SIGTERM');

    // Force kill after 5 seconds
    const forceKillTimer = setTimeout(() => {
      try {
        agent.pty.kill('SIGKILL');
      } catch {
        // Already dead
      }
    }, 5000);

    // Clean up on exit (onExit handler above updates DB)
    const origOnExit = agent.pty.onExit;
    agent.pty.onExit(({ exitCode }) => {
      clearTimeout(forceKillTimer);
      updateSessionStatus(sessionId, 'stopped');
      this.agents.delete(sessionId);
      this.emit('agent:status', { sessionId, status: 'stopped', exitCode });
    });
  }

  /**
   * Resume a previously stopped/completed agent session.
   * @param {number} agentSessionId — DB row ID of the old session
   * @returns {object} new session record
   */
  resume(agentSessionId) {
    const oldSession = getSession(agentSessionId);
    if (!oldSession) throw new Error(`Session ${agentSessionId} not found`);
    if (!oldSession.claude_session_id) throw new Error('Session has no Claude session ID — cannot resume');

    const project = getProject(oldSession.project_id);
    if (!project) throw new Error(`Project ${oldSession.project_id} not found`);
    if (!existsSync(project.local_path)) {
      throw new Error(`Project path does not exist: ${project.local_path}`);
    }

    const claudeSessionId = oldSession.claude_session_id;
    const args = ['--resume', claudeSessionId, '--dangerously-skip-permissions'];

    const proc = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: project.local_path,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    // Create a new DB session linked to the same claude_session_id
    const sessionId = createSession({
      projectId: oldSession.project_id,
      issueNumber: oldSession.issue_number,
      issueTitle: oldSession.issue_title,
      pid: proc.pid,
      worktreePath: oldSession.worktree_path,
      branchName: oldSession.branch_name,
      claudeSessionId,
    });

    const agent = { pty: proc, log: [], logBytes: 0 };
    this.agents.set(sessionId, agent);

    proc.onData((data) => {
      agent.log.push(data);
      agent.logBytes += data.length;
      while (agent.logBytes > MAX_LOG_BYTES && agent.log.length > 1) {
        const removed = agent.log.shift();
        agent.logBytes -= removed.length;
      }
      this.emit('agent:output', { sessionId, data });
    });

    proc.onExit(({ exitCode }) => {
      const status = exitCode === 0 ? 'completed' : 'failed';
      updateSessionStatus(sessionId, status);
      this.agents.delete(sessionId);
      this.emit('agent:status', { sessionId, status, exitCode });
    });

    this.emit('agent:launched', { sessionId, projectId: oldSession.project_id, issueNumber: oldSession.issue_number });

    return getSession(sessionId);
  }

  /**
   * Broadcast a message to all running agents.
   */
  broadcast(message) {
    let count = 0;
    for (const [sessionId, agent] of this.agents) {
      agent.pty.write(message);
      setTimeout(() => agent.pty.write('\r'), 100);
      count++;
    }
    return count;
  }

  /**
   * Get the log buffer for an agent (running or recently stopped).
   */
  getLog(sessionId) {
    const agent = this.agents.get(sessionId);
    if (!agent) return '';
    return agent.log.join('');
  }

  /**
   * Check if an agent is running.
   */
  isRunning(sessionId) {
    return this.agents.has(sessionId);
  }

  /**
   * Check if an agent process is alive (PID exists).
   */
  isHealthy(sessionId) {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    try {
      process.kill(agent.pty.pid, 0); // signal 0 = just check existence
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get count of running agents.
   */
  get runningCount() {
    return this.agents.size;
  }

  /**
   * Get all running session IDs.
   */
  getAllRunningIds() {
    return [...this.agents.keys()];
  }

  /**
   * Stop all running agents (for graceful shutdown).
   */
  stopAll() {
    for (const [sessionId] of this.agents) {
      try {
        this.stop(sessionId);
      } catch {
        // Ignore errors during shutdown
      }
    }
  }
}

// Singleton
export const agentManager = new AgentManager();
