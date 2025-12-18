const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');

// Load config
const configPath = path.join(__dirname, 'config.json');
let config = {
  port: 3000,
  shell: process.env.SHELL || '/bin/bash',
  workingDirectory: process.env.HOME || '/home',
  discord: {
    enabled: false,
    webhookUrl: ''
  }
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

// Discord notification function
async function sendDiscordNotification(message) {
  if (!config.discord?.enabled || !config.discord?.webhookUrl) {
    return;
  }

  try {
    const response = await fetch(config.discord.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        username: 'Terminal AI Control',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2593/2593635.png'
      })
    });

    if (!response.ok) {
      console.error('Discord webhook failed:', response.status);
    }
  } catch (error) {
    console.error('Discord notification error:', error.message);
  }
}

// Terminal sessions storage - Map of socket.id -> Map of terminal.id -> terminal data
const terminals = new Map();
let terminalIdCounter = 0;

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Initialize terminals map for this socket
  terminals.set(socket.id, new Map());

  // Create new terminal session
  socket.on('terminal:create', (options = {}) => {
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

      const socketTerminals = terminals.get(socket.id);
      socketTerminals.set(terminalId, {
        pty: ptyProcess,
        lastActivity: Date.now(),
        commandBuffer: ''
      });

      // Send terminal output to client
      ptyProcess.onData((data) => {
        socket.emit('terminal:data', { terminalId, data });

        const term = socketTerminals.get(terminalId);
        if (term) {
          term.lastActivity = Date.now();
          term.commandBuffer += data;

          // Detect command completion patterns for notifications
          // This is a simple heuristic - looks for shell prompt patterns
          if (term.notifyOnComplete &&
              (data.includes('$ ') || data.includes('# ') || data.includes('> '))) {
            const outputPreview = term.commandBuffer.slice(-200).trim();
            sendDiscordNotification(`✅ **작업 완료**\n\`\`\`\n${outputPreview}\n\`\`\``);
            term.notifyOnComplete = false;
            term.commandBuffer = '';
          }
        }
      });

      ptyProcess.onExit(({ exitCode }) => {
        socket.emit('terminal:exit', { terminalId, exitCode });
        socketTerminals.delete(terminalId);
      });

      socket.emit('terminal:ready', { terminalId, pid: ptyProcess.pid });
      console.log(`Terminal ${terminalId} created for ${socket.id}, PID: ${ptyProcess.pid}`);

    } catch (error) {
      console.error('Failed to create terminal:', error);
      socket.emit('terminal:error', error.message);
    }
  });

  // Handle input from client
  socket.on('terminal:input', ({ terminalId, data }) => {
    const socketTerminals = terminals.get(socket.id);
    const term = socketTerminals?.get(terminalId);
    if (term?.pty) {
      term.pty.write(data);

      // If Enter key is pressed, mark for notification
      if (data === '\r' || data === '\n') {
        term.notifyOnComplete = config.discord?.enabled;
        term.commandBuffer = '';
      }
    }
  });

  // Resize terminal
  socket.on('terminal:resize', ({ terminalId, cols, rows }) => {
    const socketTerminals = terminals.get(socket.id);
    const term = socketTerminals?.get(terminalId);
    if (term?.pty) {
      term.pty.resize(cols, rows);
    }
  });

  // Close specific terminal
  socket.on('terminal:close', ({ terminalId }) => {
    const socketTerminals = terminals.get(socket.id);
    const term = socketTerminals?.get(terminalId);
    if (term?.pty) {
      term.pty.kill();
      socketTerminals.delete(terminalId);
      console.log(`Terminal ${terminalId} closed for ${socket.id}`);
    }
  });

  // Request notification for long-running task
  socket.on('terminal:notify-on-complete', ({ terminalId }) => {
    const socketTerminals = terminals.get(socket.id);
    const term = socketTerminals?.get(terminalId);
    if (term) {
      term.notifyOnComplete = true;
      term.commandBuffer = '';
      sendDiscordNotification('⏳ **작업 시작됨** - 완료 시 알림을 보내드릴게요.');
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const socketTerminals = terminals.get(socket.id);
    if (socketTerminals) {
      socketTerminals.forEach((term) => {
        if (term?.pty) {
          term.pty.kill();
        }
      });
      terminals.delete(socket.id);
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  terminals.forEach((socketTerminals) => {
    socketTerminals.forEach((term) => {
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
  
  if (config.discord?.enabled) {
    sendDiscordNotification('🚀 **Terminal AI Control** 서버가 시작되었습니다.');
  }
});
