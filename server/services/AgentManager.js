import { EventEmitter } from 'events';
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

    const args = [
      '--dangerously-skip-permissions',
      '-p',
      prompt,
    ];

    // Spawn the PTY process
    const proc = pty.spawn('claude', args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: project.local_path,
      env: { ...process.env, FORCE_COLOR: '1' },
    });

    // Create DB session
    const sessionId = createSession({
      projectId,
      issueNumber,
      issueTitle,
      pid: proc.pid,
      worktreePath: null,
      branchName: null,
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
    agent.pty.write(message + '\n');
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
   * Broadcast a message to all running agents.
   */
  broadcast(message) {
    let count = 0;
    for (const [sessionId, agent] of this.agents) {
      agent.pty.write(message + '\n');
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
   * Get count of running agents.
   */
  get runningCount() {
    return this.agents.size;
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
