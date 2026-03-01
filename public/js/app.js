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
    broadcastText: '',
    launchForm: { projectId: '', issueNumber: null, issueTitle: '', count: 1 },

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
      if (this.runningCount > 0) {
        return this.runningCount + ' agent' + (this.runningCount > 1 ? 's' : '') + ' running right now.';
      }
      if (this.agents.length > 0) {
        return this.agents.length + ' session' + (this.agents.length > 1 ? 's' : '') + ' total. Launch an agent to get started.';
      }
      return 'No agents yet. Launch one to get started.';
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
        this.projects = await res.json();
      } catch (err) {
        console.error('Failed to fetch projects:', err);
      }
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
      const { projectId, issueNumber, issueTitle, count } = this.launchForm;
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
        this.launchForm = { projectId: '', issueNumber: null, issueTitle: '', count: 1 };
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
