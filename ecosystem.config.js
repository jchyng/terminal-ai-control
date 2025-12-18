module.exports = {
  apps: [{
    name: 'terminal-ai-control',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // 로그 로테이션 설정
    max_size: '10M',
    retain: 10,
    compress: true,
    // 재시작 전략
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,
    // 크래시 시 재시작
    exp_backoff_restart_delay: 100,
    // 그레이스풀 셧다운
    kill_timeout: 5000,
    listen_timeout: 3000
  }]
};
