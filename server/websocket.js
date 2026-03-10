import { WebSocketServer } from 'ws';
import { agentManager } from './services/AgentManager.js';
import { autoPilot } from './services/AutoPilot.js';

/**
 * Set up WebSocket server on an existing HTTP server.
 * Clients subscribe to specific agents or all agents.
 *
 * Client → Server messages:
 *   { type: "subscribe", sessionId: number }       — subscribe to one agent
 *   { type: "subscribe_all" }                      — subscribe to all agents
 *   { type: "unsubscribe", sessionId: number }     — unsubscribe from one agent
 *
 * Server → Client messages:
 *   { type: "output", sessionId, data }            — terminal output chunk
 *   { type: "status", sessionId, status, exitCode } — agent status change
 *   { type: "launched", sessionId, projectId, issueNumber } — new agent launched
 *   { type: "log_buffer", sessionId, data }        — catch-up log on subscribe
 */
export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  /** @type {Map<WebSocket, Set<number|'all'>>} */
  const subscriptions = new Map();

  wss.on('connection', (ws) => {
    subscriptions.set(ws, new Set());

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      const subs = subscriptions.get(ws);

      if (msg.type === 'subscribe' && msg.sessionId) {
        subs.add(msg.sessionId);
        // Send catch-up log buffer
        const log = agentManager.getLog(msg.sessionId);
        if (log) {
          send(ws, { type: 'log_buffer', sessionId: msg.sessionId, data: log });
        }
      } else if (msg.type === 'subscribe_all') {
        subs.add('all');
        // Send catch-up log buffers for all running agents
        for (const sessionId of agentManager.getAllRunningIds()) {
          const log = agentManager.getLog(sessionId);
          if (log) {
            send(ws, { type: 'log_buffer', sessionId, data: log });
          }
        }
      } else if (msg.type === 'unsubscribe' && msg.sessionId) {
        subs.delete(msg.sessionId);
      } else if (msg.type === 'input' && msg.sessionId && msg.data) {
        // Forward keypress from browser terminal to agent PTY
        try {
          agentManager.sendRawInput(msg.sessionId, msg.data);
        } catch {
          // Agent may have exited
        }
      }
    });

    ws.on('close', () => {
      subscriptions.delete(ws);
    });
  });

  // Route agent events to subscribed clients
  agentManager.on('agent:output', ({ sessionId, data }) => {
    broadcast({ type: 'output', sessionId, data }, sessionId);
  });

  agentManager.on('agent:status', ({ sessionId, status, exitCode }) => {
    broadcast({ type: 'status', sessionId, status, exitCode }, sessionId);
  });

  agentManager.on('agent:launched', ({ sessionId, projectId, issueNumber }) => {
    broadcast({ type: 'launched', sessionId, projectId, issueNumber }, null);
  });

  autoPilot.on('autopilot:launched', ({ projectId, issueNumber, issueTitle, sessionId }) => {
    broadcast({ type: 'autopilot:launched', projectId, issueNumber, issueTitle, sessionId }, null);
  });

  autoPilot.on('autopilot:idle', ({ projectId }) => {
    broadcast({ type: 'autopilot:idle', projectId }, null);
  });

  function broadcast(msg, sessionId) {
    const payload = JSON.stringify(msg);
    for (const [ws, subs] of subscriptions) {
      if (ws.readyState !== 1) continue; // OPEN
      if (subs.has('all') || (sessionId && subs.has(sessionId))) {
        ws.send(payload);
      }
    }
  }

  function send(ws, msg) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  return wss;
}
