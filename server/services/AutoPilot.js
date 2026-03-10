import { EventEmitter } from 'events';
import { agentManager } from './AgentManager.js';
import { getIssues } from './GitHubService.js';
import { getProject, getActiveSessions, getAllProjects } from './Database.js';

const DEFAULT_EXCLUDED = ['still thinking', 'wip', 'blocked'];

class AutoPilot extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, number>} projectId-issueNumber → fail count */
    this.failCounts = new Map();
    this._attached = false;
  }

  /**
   * Wire AutoPilot into AgentManager events.
   * Call once at server startup.
   */
  attach() {
    if (this._attached) return;
    this._attached = true;

    agentManager.on('agent:status', ({ sessionId, status }) => {
      this._onAgentFinished(sessionId, status);
    });
  }

  _onAgentFinished(sessionId, status) {
    const allProjects = getAllProjects();
    for (const project of allProjects) {
      if (!project.autopilot_enabled) continue;
      // Schedule check with short delay to let DB update settle
      setTimeout(() => this._tryLaunchNext(project.id, status), 500);
    }
  }

  async _tryLaunchNext(projectId, triggerStatus) {
    const project = getProject(projectId);
    if (!project || !project.autopilot_enabled) return;

    // Count agents currently running on this project
    const running = getActiveSessions().filter(s => s.project_id === projectId);
    const maxAgents = project.autopilot_max_agents ?? 3;
    if (running.length >= maxAgents) return;

    // Get excluded labels
    let excluded;
    try {
      excluded = JSON.parse(project.autopilot_excluded_labels || '[]');
    } catch {
      excluded = DEFAULT_EXCLUDED;
    }

    // Fetch open issues
    let issues;
    try {
      issues = await getIssues(project.repo);
    } catch (err) {
      console.error(`[AutoPilot] Failed to fetch issues for ${project.repo}:`, err.message);
      return;
    }

    if (!issues.length) {
      console.log(`[AutoPilot] Nothing left boss, army's chilling on ${project.name}`);
      this.emit('autopilot:idle', { projectId });
      return;
    }

    // Get issue numbers currently being worked on by running agents
    const activeIssueNumbers = new Set(running.map(s => s.issue_number).filter(Boolean));

    // Build skip list from fail counts >= 2
    const skipKeys = new Set(
      [...this.failCounts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([key]) => key)
    );

    // Filter issues
    const available = issues.filter(issue => {
      // Skip excluded labels
      const labels = issue.labels?.map(l => (typeof l === 'string' ? l : l.name).toLowerCase()) ?? [];
      if (labels.some(l => excluded.map(e => e.toLowerCase()).includes(l))) return false;
      // Skip already being worked on
      if (activeIssueNumbers.has(issue.number)) return false;
      // Skip failed twice
      if (skipKeys.has(`${projectId}-${issue.number}`)) return false;
      return true;
    });

    if (!available.length) {
      console.log(`[AutoPilot] No available issues for ${project.name} — all filtered or in-flight`);
      this.emit('autopilot:idle', { projectId });
      return;
    }

    // Pick oldest (last in array since gh returns newest first)
    const pick = available[available.length - 1];

    // Track fail count if this trigger was a failure
    if (triggerStatus === 'failed') {
      const key = `${projectId}-${pick.number}`;
      this.failCounts.set(key, (this.failCounts.get(key) ?? 0) + 1);
    }

    try {
      const session = agentManager.launch(projectId, pick.number, pick.title);
      console.log(`[AutoPilot] Picked up #${pick.number} on ${project.name} — let's get it`);
      this.emit('autopilot:launched', {
        projectId,
        issueNumber: pick.number,
        issueTitle: pick.title,
        sessionId: session.id,
      });
    } catch (err) {
      console.error(`[AutoPilot] Launch failed for #${pick.number}:`, err.message);
    }
  }

  /**
   * Manually trigger autopilot check for a project
   * (useful for testing or manual kicks via API).
   */
  kick(projectId) {
    this._tryLaunchNext(projectId, 'manual');
  }
}

export const autoPilot = new AutoPilot();
