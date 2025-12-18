const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load config
const configPath = path.join(__dirname, 'config.json');
let config = {
  port: 3000,
  shell: process.env.SHELL || '/bin/bash',
  workingDirectory: process.env.HOME || '/home'
};

if (fs.existsSync(configPath)) {
  const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config = { ...config, ...userConfig };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Circular Buffer for terminal output
class CircularBuffer {
  constructor(maxSize = 10 * 1024 * 1024) { // 10MB default
    this.maxSize = maxSize;
    this.buffer = [];
    this.currentSize = 0;
  }

  add(data) {
    const dataSize = Buffer.byteLength(data, 'utf8');
    this.buffer.push(data);
    this.currentSize += dataSize;

    // Remove old data if exceeds max size
    while (this.currentSize > this.maxSize && this.buffer.length > 0) {
      const removed = this.buffer.shift();
      this.currentSize -= Buffer.byteLength(removed, 'utf8');
    }
  }

  getAll() {
    return this.buffer.join('');
  }

  clear() {
    this.buffer = [];
    this.currentSize = 0;
  }
}

// Session-based storage (persists across reconnects)
// sessionId -> { socket, terminals, lastActivity }
const sessions = new Map();
// Socket to session mapping
const socketToSession = new Map();
let terminalIdCounter = 0;

// Session timeout: 1 hour
const SESSION_TIMEOUT = 60 * 60 * 1000;

// Generate unique session ID
function generateSessionId() {
  return crypto.randomUUID();
}

// Clean up expired sessions
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      console.log(`[Session] Cleaning up expired session: ${sessionId}`);
      // Kill all terminal processes
      session.terminals.forEach((term) => {
        if (term.pty) {
          term.pty.kill();
        }
      });
      sessions.delete(sessionId);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  let sessionId = null;
  let session = null;

  // Handle session initialization
  socket.on('session:init', ({ sessionId: clientSessionId }) => {
    console.log(`[Session] Init request with sessionId: ${clientSessionId || 'none'}`);

    // Check if client has existing session
    if (clientSessionId && sessions.has(clientSessionId)) {
      // Reconnect to existing session
      sessionId = clientSessionId;
      session = sessions.get(sessionId);

      // Disconnect previous socket if exists
      if (session.socket && session.socket.id !== socket.id) {
        console.log(`[Session] Disconnecting previous socket for session ${sessionId}`);
        session.socket.emit('session:replaced', { message: '다른 곳에서 접속했습니다' });
        session.socket.disconnect();
      }

      // Update session with new socket
      session.socket = socket;
      session.lastActivity = Date.now();
      socketToSession.set(socket.id, sessionId);

      console.log(`[Session] Reconnected to session ${sessionId} with ${session.terminals.size} terminals`);

      // Send session info and existing terminals
      const terminalList = Array.from(session.terminals.entries()).map(([tid, term]) => ({
        terminalId: tid,
        pid: term.pty.pid,
        tabNumber: term.tabNumber,
        customName: term.customName
      }));

      socket.emit('session:restored', {
        sessionId,
        terminals: terminalList
      });

      // Send buffered output for each terminal
      session.terminals.forEach((term, tid) => {
        const bufferedOutput = term.outputBuffer.getAll();
        if (bufferedOutput) {
          console.log(`[Session] Sending ${bufferedOutput.length} bytes of buffered output for ${tid}`);
          socket.emit('terminal:buffered', { terminalId: tid, data: bufferedOutput });
        }
      });

    } else {
      // Create new session
      sessionId = generateSessionId();
      session = {
        socket: socket,
        terminals: new Map(),
        lastActivity: Date.now(),
        tabCounter: 0
      };
      sessions.set(sessionId, session);
      socketToSession.set(socket.id, sessionId);

      console.log(`[Session] Created new session ${sessionId}`);

      socket.emit('session:created', { sessionId });
    }
  });

  // Create new terminal session
  socket.on('terminal:create', (options = {}) => {
    if (!session) {
      socket.emit('terminal:error', 'No active session. Please initialize session first.');
      return;
    }

    const cols = options.cols || 80;
    const rows = options.rows || 24;
    const cwd = options.cwd || config.workingDirectory;
    const terminalId = `term-${++terminalIdCounter}`;

    try {
      const ptyProcess = pty.spawn(config.shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor'
        }
      });

      const term = {
        pty: ptyProcess,
        lastActivity: Date.now(),
        outputBuffer: new CircularBuffer(),
        tabNumber: ++session.tabCounter,
        customName: null
      };

      session.terminals.set(terminalId, term);

      // Send terminal output to client
      ptyProcess.onData((data) => {
        // Add to output buffer
        term.outputBuffer.add(data);
        term.lastActivity = Date.now();

        // Send to client if connected
        if (session.socket && session.socket.connected) {
          session.socket.emit('terminal:data', { terminalId, data });
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (session.socket && session.socket.connected) {
          session.socket.emit('terminal:exit', { terminalId, exitCode });
        }
        session.terminals.delete(terminalId);
      });

      socket.emit('terminal:ready', { terminalId, pid: ptyProcess.pid, tabNumber: term.tabNumber, customName: term.customName });
      console.log(`Terminal ${terminalId} created for session ${sessionId}, PID: ${ptyProcess.pid}`);

    } catch (error) {
      console.error('Failed to create terminal:', error);
      socket.emit('terminal:error', error.message);
    }
  });

  // Handle input from client
  socket.on('terminal:input', ({ terminalId, data }) => {
    if (!session) return;
    const term = session.terminals.get(terminalId);
    if (term?.pty) {
      term.pty.write(data);
    }
  });

  // Resize terminal
  socket.on('terminal:resize', ({ terminalId, cols, rows }) => {
    if (!session) return;
    const term = session.terminals.get(terminalId);
    if (term?.pty) {
      term.pty.resize(cols, rows);
    }
  });

  // Close specific terminal
  socket.on('terminal:close', ({ terminalId }) => {
    if (!session) return;
    const term = session.terminals.get(terminalId);
    if (term?.pty) {
      term.pty.kill();
      session.terminals.delete(terminalId);
      console.log(`Terminal ${terminalId} closed for session ${sessionId}`);
    }
  });

  // Rename terminal
  socket.on('terminal:rename', ({ terminalId, customName }) => {
    if (!session) return;
    const term = session.terminals.get(terminalId);
    if (term) {
      term.customName = customName || null;
      console.log(`Terminal ${terminalId} renamed to: ${customName || 'default'}`);
    }
  });

  // Cleanup on disconnect (DO NOT kill PTY processes - keep session alive)
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    if (sessionId && session) {
      // Clear socket reference but keep session alive
      console.log(`[Session] Socket disconnected but session ${sessionId} kept alive with ${session.terminals.size} terminals`);
      session.socket = null;
      session.lastActivity = Date.now();
    }

    socketToSession.delete(socket.id);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  sessions.forEach((session) => {
    session.terminals.forEach((term) => {
      if (term.pty) term.pty.kill();
    });
  });
  server.close();
  process.exit(0);
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🖥️  Terminal AI Control Plane                            ║
║                                                            ║
║   Server running on http://0.0.0.0:${config.port.toString().padEnd(5)}                  ║
║                                                            ║
║   Your server. Your network. Your AI.                      ║
║   No cloud. No SSH in the browser.                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
