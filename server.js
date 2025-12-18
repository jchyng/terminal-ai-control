const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Logger utility
const logger = {
  info: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ level: 'info', timestamp, message, ...meta }));
  },
  warn: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.warn(JSON.stringify({ level: 'warn', timestamp, message, ...meta }));
  },
  error: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    console.error(JSON.stringify({ level: 'error', timestamp, message, ...meta }));
  },
  debug: (message, meta = {}) => {
    const timestamp = new Date().toISOString();
    if (process.env.DEBUG) {
      console.log(JSON.stringify({ level: 'debug', timestamp, message, ...meta }));
    }
  }
};

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
      logger.info('Cleaning up expired session', { sessionId, terminalCount: session.terminals.size });
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

// --- Helper function for file tree ---
const ignoredDirs = new Set(['node_modules', '.git', '.vscode', '__pycache__']);

async function readDirectoryRecursive(dirPath) {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const tree = [];

    for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) {
            continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        try {
            if (entry.isDirectory()) {
                tree.push({
                    name: entry.name,
                    path: fullPath,
                    type: 'directory',
                    children: await readDirectoryRecursive(fullPath)
                });
            } else {
                tree.push({
                    name: entry.name,
                    path: fullPath,
                    type: 'file'
                });
            }
        } catch (err) {
            if (err.code === 'EACCES' && entry.isDirectory()) {
                // If it's a directory we can't access, note it in the tree
                tree.push({
                    name: entry.name,
                    path: fullPath,
                    type: 'directory',
                    error: 'permission_denied',
                    children: []
                });
            } else {
                // For other errors, or for files we can't read, just log and skip
                logger.warn('Could not read path', { path: fullPath, error: err.message });
            }
        }
    }
    
    // Sort directories first, then files, all alphabetically
    tree.sort((a, b) => {
        if (a.type === b.type) {
            return a.name.localeCompare(b.name);
        }
        return a.type === 'directory' ? -1 : 1;
    });

    return tree;
}
// --- End Helper function ---

io.on('connection', (socket) => {
  logger.info('Client connected', { socketId: socket.id });
  let sessionId = null;
  let session = null;

  // Handle session initialization
  socket.on('session:init', ({ sessionId: clientSessionId }) => {
    logger.info('Session init request', { clientSessionId: clientSessionId || 'none' });

    // Check if client has existing session
    if (clientSessionId && sessions.has(clientSessionId)) {
      // Reconnect to existing session
      sessionId = clientSessionId;
      session = sessions.get(sessionId);

      // Disconnect previous socket if exists
      if (session.socket && session.socket.id !== socket.id) {
        logger.info('Disconnecting previous socket for session', { sessionId, oldSocketId: session.socket.id });
        session.socket.emit('session:replaced', { message: '다른 곳에서 접속했습니다' });
        session.socket.disconnect();
      }

      // Update session with new socket
      session.socket = socket;
      session.lastActivity = Date.now();
      socketToSession.set(socket.id, sessionId);

      logger.info('Session reconnected', { sessionId, terminalCount: session.terminals.size });

      // Send session info and existing terminals
      const terminalList = Array.from(session.terminals.entries()).map(([tid, term]) => ({
        terminalId: tid,
        pid: term.pty.pid,
        tabNumber: term.tabNumber,
        customName: term.customName
      }));

      socket.emit('session:restored', {
        sessionId,
        terminals: terminalList,
        workingDirectory: config.workingDirectory // Send initial CWD
      });

      // Send buffered output for each terminal
      session.terminals.forEach((term, tid) => {
        const bufferedOutput = term.outputBuffer.getAll();
        if (bufferedOutput) {
          logger.debug('Sending buffered output', { terminalId: tid, bytes: bufferedOutput.length });
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

      logger.info('New session created', { sessionId });

      socket.emit('session:created', { sessionId, workingDirectory: config.workingDirectory });
    }
  });

  // Handle file tree requests
  socket.on('filetree:get', async ({ targetPath }) => {
    if (!session) {
      socket.emit('filetree:error', 'No active session.');
      return;
    }
    
    // Use the project's root working directory as the base
    const basePath = config.workingDirectory;
    
    // Security check to prevent directory traversal above the configured working directory
    const requestedPath = targetPath ? path.resolve(targetPath) : path.resolve(basePath);
    if (!requestedPath.startsWith(path.resolve(basePath))) {
        socket.emit('filetree:error', 'Access denied: Path is outside the working directory.');
        return;
    }

    try {
      const tree = await readDirectoryRecursive(requestedPath);
      socket.emit('filetree:data', { path: requestedPath, tree });
    } catch (error) {
      logger.error('File tree error', { path: requestedPath, error: error.message });
      socket.emit('filetree:error', `Failed to read directory: ${error.message}`);
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
          COLORTERM: 'truecolor',
          PROMPT_COMMAND: 'printf "\\033]777;CWD=%s\\007" "$(pwd)"'
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
      logger.info('Terminal created', { terminalId, sessionId, pid: ptyProcess.pid, tabNumber: term.tabNumber });

    } catch (error) {
      logger.error('Failed to create terminal', { error: error.message, stack: error.stack });
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
      logger.info('Terminal closed', { terminalId, sessionId });
    }
  });

  // Rename terminal
  socket.on('terminal:rename', ({ terminalId, customName }) => {
    if (!session) return;
    const term = session.terminals.get(terminalId);
    if (term) {
      term.customName = customName || null;
      logger.info('Terminal renamed', { terminalId, customName: customName || 'default' });
    }
  });

  // Cleanup on disconnect (DO NOT kill PTY processes - keep session alive)
  socket.on('disconnect', () => {
    logger.info('Client disconnected', { socketId: socket.id });

    if (sessionId && session) {
      // Clear socket reference but keep session alive
      logger.info('Session kept alive after disconnect', { sessionId, terminalCount: session.terminals.size });
      session.socket = null;
      session.lastActivity = Date.now();
    }

    socketToSession.delete(socket.id);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Shutting down server', { totalSessions: sessions.size });
  sessions.forEach((session) => {
    session.terminals.forEach((term) => {
      if (term.pty) term.pty.kill();
    });
  });
  server.close(() => {
    logger.info('Server closed successfully');
    process.exit(0);
  });
});

server.listen(config.port, '0.0.0.0', () => {
  const banner = `
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
  `;
  console.log(banner);
  logger.info('Server started successfully', {
    port: config.port,
    shell: config.shell,
    workingDirectory: config.workingDirectory,
    nodeVersion: process.version,
    platform: process.platform
  });
});
