/* AgentArmy — Alpine.js app */

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    agents: [],
    projects: [],
    terminals: {},

    showLaunchModal: false,
    showBroadcastModal: false,
    broadcastText: '',
    launchForm: { projectId: '', issueNumber: null, issueTitle: '' },

    ws: null,
    wsRetryDelay: 1000,

    async init() {
      await this.fetchProjects();
      await this.fetchAgents();
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
        // Preserve _inputMsg field
        for (const agent of data) {
          const existing = this.agents.find((a) => a.id === agent.id);
          agent._inputMsg = existing ? existing._inputMsg : '';
        }
        this.agents = data;
      } catch (err) {
        console.error('Failed to fetch agents:', err);
      }
    },

    launchError: '',
    launching: false,

    async launchAgent() {
      const { projectId, issueNumber, issueTitle } = this.launchForm;
      if (!projectId) return;

      this.launching = true;
      this.launchError = '';

      try {
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
          this.launchError = data.error || `Launch failed (${res.status})`;
          return;
        }
        data.live = true;
        data._inputMsg = '';
        this.agents.unshift(data);
        this.showLaunchModal = false;
        this.launchForm = { projectId: '', issueNumber: null, issueTitle: '' };
        this.subscribe(data.id);
      } catch (err) {
        this.launchError = `Network error: ${err.message}`;
      } finally {
        this.launching = false;
      }
    },

    async sendMessage(sessionId, message) {
      if (!message || !message.trim()) return;
      try {
        await fetch(`/api/agents/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        });
      } catch (err) {
        console.error('Failed to send message:', err);
      }
    },

    async stopAgent(sessionId) {
      try {
        await fetch(`/api/agents/${sessionId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Failed to stop agent:', err);
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
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
        theme: {
          background: '#0a0a0a',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          selectionBackground: 'rgba(255, 255, 255, 0.15)',
          black: '#0a0a0a',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#fbbf24',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#22d3ee',
          white: '#d4d4d4',
        },
        cursorBlink: false,
        disableStdin: true,
        scrollback: 5000,
        convertEol: true,
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);
      fitAddon.fit();

      this.terminals[sessionId] = { term, fitAddon };

      // Refit on window resize
      const resizeHandler = () => fitAddon.fit();
      window.addEventListener('resize', resizeHandler);

      // Subscribe via WebSocket
      this.subscribe(sessionId);
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
        // Subscribe to all existing agents
        this.ws.send(JSON.stringify({ type: 'subscribe_all' }));
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'output' || msg.type === 'log_buffer') {
          const entry = this.terminals[msg.sessionId];
          if (entry) {
            entry.term.write(msg.data);
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
          // Refresh agent list to pick up new agents from other clients
          this.fetchAgents();
        }
      };

      this.ws.onclose = () => {
        // Auto-reconnect with backoff
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
