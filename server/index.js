import 'dotenv/config';

import { createServer } from 'http';
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { setupWebSocket } from './websocket.js';
import { seedProjects } from './seed.js';
import { agentManager } from './services/AgentManager.js';
import { closeDb, seedDefaultPrompts } from './services/Database.js';

import agentsRouter from './routes/agents.js';
import broadcastRouter from './routes/broadcast.js';
import promptsRouter from './routes/prompts.js';
import githubRouter from './routes/github.js';
import healthRouter from './routes/health.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, '../public')));

// API routes
app.use('/api/agents', agentsRouter);
app.use('/api/broadcast', broadcastRouter);
app.use('/api/prompts', promptsRouter);
app.use('/api/projects', githubRouter);
app.use('/health', healthRouter);

// WebSocket
setupWebSocket(server);

// Auto-seed projects and default prompts on first boot
seedProjects();
seedDefaultPrompts();

// Start — find an open port if the default is taken
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const next = server.address()?.port ?? PORT;
    if (next < +PORT + 10) {
      console.log(`Port ${next} in use, trying ${next + 1}...`);
      server.listen(next + 1);
    } else {
      console.error(`Ports ${PORT}–${next} all in use. Set PORT env or free one up.`);
      process.exit(1);
    }
  } else {
    throw err;
  }
});

server.listen(PORT, () => {
  console.log(`AgentArmy running at http://localhost:${server.address().port}`);
});

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  agentManager.stopAll();
  closeDb();
  server.close(() => {
    console.log('Goodbye.');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
