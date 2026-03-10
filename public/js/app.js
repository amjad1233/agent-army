/* AgentArmy — Alpine.js app */

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    // Screen: 'dashboard' or 'agents'
    screen: 'dashboard',

    // Theme: 'dark', 'light', 'midnight', 'ember'
    theme: localStorage.getItem('agentarmy-theme') || 'dark',

    agents: [],
    projects: [],
    terminals: {},
    pendingLogs: {},  // buffer log data for terminals not yet initialized
    activeTab: null,

    showLaunchModal: false,
    showBroadcastModal: false,
    showPromptLibrary: false,
    broadcastText: '',
    launchForm: { projectId: '', issueNumber: null, issueTitle: '', prompt: '', count: 1 },
    projectIssues: [],
    loadingIssues: false,

    prompts: [],
    newPromptTitle: '',
    newPromptBody: '',
    showAddPromptForm: false,

    showOnboardModal: false,
    onboardType: 'new',  // 'new' or 'existing'
    onboardProjectId: '',
    showOffboardModal: false,
    offboardProjectId: '',

    showAddProjectModal: false,
    addProjectForm: { localPath: '', githubProjectNumber: '' },
    addProjectValidation: { state: 'idle', name: '', repo: '', error: '' }, // idle|checking|valid|error
    addProjectError: '',
    addingProject: false,
    toasts: [],

    ws: null,
    wsRetryDelay: 1000,

    launchError: '',
    launching: false,

    // --- Computed-style getters ---

    get runningCount() {
      return this.agents.filter(a => a.live).length;
    },

    get runningAgents() {
      return this.agents.filter(a => a.live);
    },

    get completedCount() {
      return this.agents.filter(a => !a.live && a.status === 'completed').length;
    },

    get failedCount() {
      return this.agents.filter(a => a.status === 'failed').length;
    },

    get successRate() {
      const finished = this.agents.filter(a => !a.live).length;
      if (finished === 0) return '—';
      const pct = Math.round((this.completedCount / finished) * 100);
      return pct + '%';
    },

    get greeting() {
      const hour = new Date().getHours();
      if (hour < 12) return 'Good morning';
      if (hour < 18) return 'Good afternoon';
      return 'Good evening';
    },

    get dashboardSubtitle() {
      const autoPilotCount = this.projects.filter(p => p.autopilot_enabled).length;
      if (this.runningCount > 0 && autoPilotCount > 0) {
        return `${this.runningCount} agent${this.runningCount > 1 ? 's' : ''} grinding rn — AutoPilot's got the wheel 🤖`;
      }
      if (this.runningCount > 0) {
        return `${this.runningCount} agent${this.runningCount > 1 ? 's' : ''} grinding rn.`;
      }
      if (autoPilotCount > 0) {
        return `AutoPilot's watching ${autoPilotCount} project${autoPilotCount > 1 ? 's' : ''} — it'll pick something up.`;
      }
      if (this.agents.length > 0) {
        return `${this.agents.length} session${this.agents.length > 1 ? 's' : ''} total. Launch one to get going.`;
      }
      return "Your army's idle. Launch one to get going.";
    },

    // --- Theme ---

    setTheme(name) {
      this.theme = name;
      localStorage.setItem('agentarmy-theme', name);
      // Update all existing terminals to match the new theme
      const colors = this.getTerminalTheme();
      for (const entry of Object.values(this.terminals)) {
        entry.term.options.theme = colors;
      }
    },

    getTerminalTheme() {
      const themes = {
        dark:     { background: '#0A0C0E', foreground: '#d4d4d4', cursor: '#d4d4d4', black: '#0A0C0E', red: '#EF4444', green: '#22C55E', yellow: '#F59E0B', blue: '#60A5FA', magenta: '#A78BFA', cyan: '#22d3ee', white: '#F1F5F9' },
        light:    { background: '#1E1E1E', foreground: '#d4d4d4', cursor: '#d4d4d4', black: '#1E1E1E', red: '#DC2626', green: '#16A34A', yellow: '#D97706', blue: '#2563EB', magenta: '#7C3AED', cyan: '#0891B2', white: '#F1F5F9' },
        midnight: { background: '#0B1120', foreground: '#c8d6e5', cursor: '#c8d6e5', black: '#0B1120', red: '#F87171', green: '#34D399', yellow: '#FBBF24', blue: '#818CF8', magenta: '#C084FC', cyan: '#22d3ee', white: '#E2E8F0' },
        ember:    { background: '#110C08', foreground: '#d4c4b4', cursor: '#d4c4b4', black: '#110C08', red: '#EF4444', green: '#22C55E', yellow: '#F59E0B', blue: '#60A5FA', magenta: '#FB923C', cyan: '#22d3ee', white: '#F5EDE8' },
      };
      return { ...themes[this.theme] || themes.dark, selectionBackground: 'rgba(255, 255, 255, 0.15)' };
    },

    // --- Init ---

    async init() {
      // Apply saved theme immediately
      document.body.setAttribute('data-theme', this.theme);
      await this.fetchProjects();
      await this.fetchAgents();
      await this.fetchPrompts();
      // Auto-select first tab
      if (this.agents.length > 0) {
        this.activeTab = this.agents[0].id;
      }
      // If there are running agents, stay on dashboard to see overview
      // If no agents at all, stay on dashboard too
      this.connectWebSocket();
    },

    // --- REST calls ---

    async fetchProjects() {
      try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        this.projects = data.map(p => ({
          ...p,
          autopilot_excluded_labels: typeof p.autopilot_excluded_labels === 'string'
            ? JSON.parse(p.autopilot_excluded_labels || '[]')
            : (p.autopilot_excluded_labels || []),
        }));
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      }
    },

    async validateProjectPath() {
      const path = this.addProjectForm.localPath.trim();
      if (!path || path.length < 3) {
        this.addProjectValidation = { state: 'idle', name: '', repo: '', error: '' };
        return;
      }
      this.addProjectValidation = { state: 'checking', name: '', repo: '', error: '' };
      try {
        const res = await fetch('/api/projects/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localPath: path }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.addProjectValidation = { state: 'error', name: '', repo: '', error: data.error };
        } else if (data.alreadyRegistered) {
          this.addProjectValidation = { state: 'error', name: data.name, repo: data.repo, error: 'Already registered bro' };
        } else {
          this.addProjectValidation = { state: 'valid', name: data.name, repo: data.repo, error: '' };
        }
      } catch (err) {
        this.addProjectValidation = { state: 'error', name: '', repo: '', error: 'Could not connect to server' };
      }
    },

    async addProject() {
      if (this.addProjectValidation.state !== 'valid') return;
      this.addingProject = true;
      this.addProjectError = '';
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            localPath: this.addProjectForm.localPath.trim(),
            githubProjectNumber: this.addProjectForm.githubProjectNumber || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          this.addProjectError = data.error || 'Failed to add project';
          return;
        }
        data.autopilot_excluded_labels = JSON.parse(data.autopilot_excluded_labels || '[]');
        this.projects.push(data);
        this.showAddProjectModal = false;
        this.addProjectForm = { localPath: '', githubProjectNumber: '' };
        this.addProjectValidation = { state: 'idle', name: '', repo: '', error: '' };
        this.showToast(`${data.name} added to the army 🤙`);
      } catch (err) {
        this.addProjectError = `Network error: ${err.message}`;
      } finally {
        this.addingProject = false;
      }
    },

    async removeProject(id) {
      if (!confirm('Remove this project from AgentArmy? (Agents will not be affected)')) return;
      try {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error);
          return;
        }
        this.projects = this.projects.filter(p => p.id !== id);
      } catch (err) {
        alert(`Failed: ${err.message}`);
      }
    },

    async toggleAutopilot(projectId) {
      const project = this.projects.find(p => p.id === projectId);
      if (!project) return;
      const newEnabled = !project.autopilot_enabled;
      try {
        const res = await fetch(`/api/projects/${projectId}/autopilot`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: newEnabled,
            maxAgents: project.autopilot_max_agents ?? 3,
            excludedLabels: project.autopilot_excluded_labels ?? [],
          }),
        });
        if (res.ok) {
          project.autopilot_enabled = newEnabled ? 1 : 0;
          if (newEnabled) this.showToast(`AutoPilot on for ${project.name} — army's self-running now 🤖`);
        }
      } catch (err) {
        console.error('Failed to toggle autopilot:', err);
      }
    },

    async updateAutopilotMax(projectId, delta) {
      const project = this.projects.find(p => p.id === projectId);
      if (!project) return;
      const newMax = Math.max(1, Math.min(10, (project.autopilot_max_agents ?? 3) + delta));
      project.autopilot_max_agents = newMax;
      try {
        await fetch(`/api/projects/${projectId}/autopilot`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: !!project.autopilot_enabled,
            maxAgents: newMax,
            excludedLabels: project.autopilot_excluded_labels ?? [],
          }),
        });
      } catch (err) {
        console.error('Failed to update max agents:', err);
      }
    },

    showToast(message, duration = 4000) {
      const id = Date.now();
      this.toasts.push({ id, message });
      setTimeout(() => {
        this.toasts = this.toasts.filter(t => t.id !== id);
      }, duration);
    },

    async fetchProjectIssues(projectId) {
      if (!projectId) { this.projectIssues = []; return; }
      this.loadingIssues = true;
      this.projectIssues = [];
      try {
        const res = await fetch(`/api/projects/${projectId}/issues`);
        if (res.ok) this.projectIssues = await res.json();
      } catch (err) {
        console.error('Failed to fetch issues:', err);
      } finally {
        this.loadingIssues = false;
      }
    },

    selectIssue(issue) {
      this.launchForm.issueNumber = issue.number;
      this.launchForm.issueTitle = issue.title;
      this.launchForm.prompt = `Fix GitHub issue #${issue.number}: ${issue.title}\n\nCreate a PR when done.`;
    },

    async fetchAgents() {
      try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        this.agents = data;
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }
    },

    async launchAgent() {
      const { projectId, issueNumber, issueTitle, prompt, count } = this.launchForm;
      if (!projectId) return;

      const total = Math.max(1, Math.min(count || 1, 10));
      this.launching = true;
      this.launchError = '';

      try {
        let lastId = null;
        for (let i = 0; i < total; i++) {
          const res = await fetch('/api/agents/launch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: parseInt(projectId),
              issueNumber: issueNumber || null,
              issueTitle: issueTitle || null,
              customPrompt: prompt || null,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            this.launchError = data.error || `Launch failed (${res.status}) on agent ${i + 1}`;
            return;
          }
          data.live = true;
          this.agents.unshift(data);
          this.subscribe(data.id);
          lastId = data.id;
        }
        // Switch to agents screen and the last launched agent's tab
        this.activeTab = lastId;
        this.screen = 'agents';
        this.showLaunchModal = false;
        this.launchForm = { projectId: '', issueNumber: null, issueTitle: '', prompt: '', count: 1 };
        this.projectIssues = [];
        // Focus terminal after render
        this.$nextTick(() => this.focusTerminal(lastId));
      } catch (err) {
        this.launchError = `Network error: ${err.message}`;
      } finally {
        this.launching = false;
      }
    },

    async stopAgent(sessionId) {
      try {
        await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to stop agent:', err);
      }
    },

    async stopAllAgents() {
      if (!confirm('Stop all running agents?')) return;
      try {
        await fetch('/api/agents/stop-all', { method: 'POST' });
        await this.fetchAgents();
      } catch (err) {
        console.error('Failed to stop all:', err);
      }
    },

    async resumeAgent(sessionId) {
      try {
        const res = await fetch(`/api/agents/${sessionId}/resume`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Resume failed');
          return;
        }
        data.live = true;
        this.agents.unshift(data);
        this.subscribe(data.id);
        this.activeTab = data.id;
        this.screen = 'agents';
        this.$nextTick(() => this.focusTerminal(data.id));
      } catch (err) {
        alert(`Resume failed: ${err.message}`);
      }
    },

    async clearFinished() {
      try {
        await fetch('/api/agents', { method: 'DELETE' });
        // Destroy terminals for non-running agents
        for (const agent of this.agents) {
          if (!agent.live) this.destroyTerminal(agent.id);
        }
        await this.fetchAgents();
        // Fix active tab if it was removed
        if (!this.agents.find((a) => a.id === this.activeTab)) {
          this.activeTab = this.agents.length > 0 ? this.agents[0].id : null;
        }
      } catch (err) {
        console.error('Failed to clear finished:', err);
      }
    },

    closeTab(sessionId) {
      const agent = this.agents.find((a) => a.id === sessionId);
      if (agent && agent.live) {
        // Stop the agent first
        this.stopAgent(sessionId);
      }
      // Remove from UI
      this.destroyTerminal(sessionId);
      this.agents = this.agents.filter((a) => a.id !== sessionId);
      // Switch to next tab
      if (this.activeTab === sessionId) {
        this.activeTab = this.agents.length > 0 ? this.agents[0].id : null;
      }
    },

    async shutdownServer() {
      if (!confirm('Quit AgentArmy? This stops all agents and shuts down the server.')) return;
      try {
        await fetch('/health/shutdown', { method: 'POST' });
      } catch {
        // Expected — server exits, connection drops
      }
    },

    async broadcastMessage() {
      const msg = this.broadcastText.trim();
      if (!msg) return;
      try {
        await fetch('/api/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg }),
        });
        this.showBroadcastModal = false;
        this.broadcastText = '';
      } catch (err) {
        console.error('Failed to broadcast:', err);
      }
    },

    // --- Prompt Library ---

    async fetchPrompts() {
      try {
        const res = await fetch('/api/prompts');
        this.prompts = await res.json();
      } catch (err) {
        console.error('Failed to fetch prompts:', err);
      }
    },

    async addPrompt() {
      const title = this.newPromptTitle.trim();
      const body = this.newPromptBody.trim();
      if (!title || !body) return;
      try {
        const res = await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body }),
        });
        const prompt = await res.json();
        this.prompts.unshift(prompt);
        this.newPromptTitle = '';
        this.newPromptBody = '';
        this.showAddPromptForm = false;
      } catch (err) {
        console.error('Failed to add prompt:', err);
      }
    },

    async deletePrompt(id) {
      try {
        await fetch(`/api/prompts/${id}`, { method: 'DELETE' });
        this.prompts = this.prompts.filter(p => p.id !== id);
      } catch (err) {
        console.error('Failed to delete prompt:', err);
      }
    },

    async sendPromptToAgent(body) {
      if (!this.activeTab) return;
      try {
        await fetch(`/api/agents/${this.activeTab}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: body }),
        });
        this.showPromptLibrary = false;
      } catch (err) {
        console.error('Failed to send prompt to agent:', err);
      }
    },

    // --- Onboard / Offboard ---

    async launchOnboard() {
      const projectId = this.onboardProjectId;
      if (!projectId) return;
      const prompt = this.prompts.find(p =>
        this.onboardType === 'new' ? p.title === 'New project setup' : p.title === 'Onboard existing project'
      );
      if (!prompt) {
        alert('Prompt not found in library. Add it first.');
        return;
      }
      try {
        const res = await fetch('/api/agents/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: parseInt(projectId), customPrompt: prompt.body }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Launch failed'); return; }
        data.live = true;
        this.agents.unshift(data);
        this.subscribe(data.id);
        this.activeTab = data.id;
        this.screen = 'agents';
        this.showOnboardModal = false;
        this.onboardProjectId = '';
        this.$nextTick(() => this.focusTerminal(data.id));
      } catch (err) {
        alert(`Launch failed: ${err.message}`);
      }
    },

    async launchOffboard() {
      const projectId = this.offboardProjectId;
      if (!projectId) return;
      const prompt = this.prompts.find(p => p.title === 'Shutdown project');
      if (!prompt) {
        alert('Prompt not found in library. Add it first.');
        return;
      }
      try {
        const res = await fetch('/api/agents/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: parseInt(projectId), customPrompt: prompt.body }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Launch failed'); return; }
        data.live = true;
        this.agents.unshift(data);
        this.subscribe(data.id);
        this.activeTab = data.id;
        this.screen = 'agents';
        this.showOffboardModal = false;
        this.offboardProjectId = '';
        this.$nextTick(() => this.focusTerminal(data.id));
      } catch (err) {
        alert(`Launch failed: ${err.message}`);
      }
    },

    // --- xterm.js ---

    initTerminal(sessionId) {
      const container = document.getElementById(`term-${sessionId}`);
      if (!container || this.terminals[sessionId]) return;

      const term = new Terminal({
        fontSize: 14,
        fontFamily: "'Azeret Mono', 'SF Mono', 'Fira Code', Menlo, monospace",
        theme: this.getTerminalTheme(),
        cursorBlink: true,
        disableStdin: false,
        scrollback: 10000,
        convertEol: true,
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      this.terminals[sessionId] = { term, fitAddon };

      // Forward keypresses to the agent PTY via WebSocket
      term.onData((data) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'input', sessionId, data }));
        }
      });

      // Refit when container or window resizes
      const resizeHandler = () => fitAddon.fit();
      window.addEventListener('resize', resizeHandler);
      new ResizeObserver(resizeHandler).observe(container);

      // Click to focus
      container.addEventListener('mousedown', () => term.focus());

      // Replay any buffered log data that arrived before terminal was ready
      if (this.pendingLogs[sessionId]) {
        for (const chunk of this.pendingLogs[sessionId]) {
          term.write(chunk);
        }
        delete this.pendingLogs[sessionId];
      }

      // Subscribe via WebSocket
      this.subscribe(sessionId);
    },

    focusTerminal(sessionId) {
      const entry = this.terminals[sessionId];
      if (entry) {
        entry.fitAddon.fit();
        entry.term.focus();
      }
    },

    destroyTerminal(sessionId) {
      const entry = this.terminals[sessionId];
      if (entry) {
        entry.term.dispose();
        delete this.terminals[sessionId];
      }
    },

    // --- WebSocket ---

    connectWebSocket() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${protocol}//${location.host}/ws`);

      this.ws.onopen = () => {
        this.wsRetryDelay = 1000;
        this.ws.send(JSON.stringify({ type: 'subscribe_all' }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'output' || msg.type === 'log_buffer') {
          const entry = this.terminals[msg.sessionId];
          if (entry) {
            entry.term.write(msg.data);
          } else {
            // Terminal not yet initialized — buffer the data
            if (!this.pendingLogs[msg.sessionId]) this.pendingLogs[msg.sessionId] = [];
            this.pendingLogs[msg.sessionId].push(msg.data);
          }
        }

        if (msg.type === 'status') {
          const agent = this.agents.find((a) => a.id === msg.sessionId);
          if (agent) {
            agent.status = msg.status;
            agent.live = false;
          }
        }

        if (msg.type === 'launched') {
          this.fetchAgents();
        }

        if (msg.type === 'autopilot:launched') {
          this.showToast(`AutoPilot picked up #${msg.issueNumber} — let's get it 🤙`);
          this.fetchAgents();
        }

        if (msg.type === 'autopilot:idle') {
          const project = this.projects.find(p => p.id === msg.projectId);
          if (project) this.showToast(`Nothing left boss, ${project.name}'s army is chilling`);
        }
      };

      this.ws.onclose = () => {
        setTimeout(() => {
          this.wsRetryDelay = Math.min(this.wsRetryDelay * 2, 30000);
          this.connectWebSocket();
        }, this.wsRetryDelay);
      };
    },

    subscribe(sessionId) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
      }
    },
  }));
});
