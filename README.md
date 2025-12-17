# 🖥️ Terminal AI Control

> Your server. Your network. Your AI.  
> No cloud. No SSH in the browser.

집 서버에서 터미널 기반 AI가 작업하고, 어디서든 웹으로 제어하는 셀프 호스팅 시스템.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)

## ✨ 특징

- **🤖 AI CLI 무관** - Claude Code, Aider, Cursor 등 어떤 터미널 AI든 사용 가능
- **🌐 어디서든 접속** - Tailscale로 회사, LTE, 5G 어디서든 안전하게 접근
- **🔒 보안** - SSH/터미널 웹 노출 없음, 포트 공개 불필요
- **📱 모바일 최적화** - 반응형 UI로 폰에서도 편하게 사용
- **🔔 Discord 알림** - 작업 완료 시 자동 알림

## 🚀 빠른 시작

### 1. 요구사항

- Node.js 18 이상
- npm 또는 yarn
- 빌드 도구 (node-pty 컴파일용)

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential python3

# macOS
xcode-select --install

# Arch Linux
sudo pacman -S base-devel
```

### 2. 설치

```bash
# 저장소 클론
git clone https://github.com/yourusername/terminal-ai-control.git
cd terminal-ai-control

# 의존성 설치
npm install
```

### 3. 설정

```bash
# 설정 파일 복사
cp config.example.json config.json

# 설정 편집
nano config.json  # 또는 vim, code 등
```

**config.json 예시:**

```json
{
  "port": 3000,
  "shell": "/bin/bash",
  "workingDirectory": "/home/yourname/projects",
  "discord": {
    "enabled": true,
    "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_URL"
  }
}
```

### 4. 실행

```bash
npm start
```

### 5. 접속

```
http://localhost:3000
```

---

## 🌍 외부 접근 설정 (Tailscale)

### 서버에 Tailscale 설치

```bash
# 설치
curl -fsSL https://tailscale.com/install.sh | sh

# 시작
sudo tailscale up

# IP 확인
tailscale ip -4
# 예: 100.64.0.1
```

### 휴대폰에 Tailscale 설치

1. iOS App Store 또는 Google Play에서 **Tailscale** 설치
2. **같은 계정**으로 로그인
3. 웹 브라우저에서 접속:

```
http://100.64.0.1:3000
```

✅ 이제 **회사, LTE, 5G** 어디서든 접근 가능!  
✅ 서버 포트 인터넷 공개 **불필요**

---

## 🔔 Discord 알림 설정

### 1. Discord Webhook 생성

1. Discord 서버에서 **서버 설정** → **연동** → **웹후크**
2. **새 웹후크** 클릭
3. 이름 설정 (예: "Terminal AI")
4. 채널 선택
5. **웹후크 URL 복사**

### 2. config.json에 적용

```json
{
  "discord": {
    "enabled": true,
    "webhookUrl": "https://discord.com/api/webhooks/1234567890/abcdefg..."
  }
}
```

### 3. 알림 받기

- **자동**: 명령 실행 완료 시 결과 요약
- **수동**: 웹 UI에서 🔔 버튼 클릭 → 현재 작업 완료 시 알림

---

## 🔧 systemd로 자동 시작 설정

서버 재부팅 시 자동으로 실행되도록 설정:

```bash
sudo nano /etc/systemd/system/terminal-ai.service
```

```ini
[Unit]
Description=Terminal AI Control
After=network.target

[Service]
Type=simple
User=yourname
WorkingDirectory=/home/yourname/terminal-ai-control
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
# 서비스 등록 및 시작
sudo systemctl daemon-reload
sudo systemctl enable terminal-ai
sudo systemctl start terminal-ai

# 상태 확인
sudo systemctl status terminal-ai

# 로그 확인
journalctl -u terminal-ai -f
```

---

## 🤖 AI CLI 사용 예시

### Claude Code

```bash
# 웹 터미널에서
claude

# 대화 시작
> 이 프로젝트의 테스트 코드 작성해줘
```

### Aider

```bash
# 웹 터미널에서
cd /path/to/project
aider

# 대화 시작
> Fix the bug in auth.py
```

### Cursor (CLI)

```bash
cursor --chat
```

---

## 📁 프로젝트 구조

```
terminal-ai-control/
├── server.js           # 메인 서버 (Express + Socket.IO + node-pty)
├── config.json         # 사용자 설정
├── config.example.json # 설정 템플릿
├── package.json        # 의존성
├── public/
│   └── index.html      # 웹 UI (xterm.js)
└── README.md           # 이 파일
```

---

## ⚙️ 설정 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `port` | 웹 서버 포트 | `3000` |
| `shell` | 사용할 쉘 | `/bin/bash` |
| `workingDirectory` | 터미널 시작 디렉터리 | `$HOME` |
| `discord.enabled` | Discord 알림 사용 | `false` |
| `discord.webhookUrl` | Discord Webhook URL | `""` |

---

## 🛡️ 보안 모델

```
┌──────────────────────────────────────────────────────┐
│  사용자 (모바일/노트북)                               │
│         │                                            │
│    Tailscale (암호화된 P2P 터널)                      │
│         │                                            │
│  ┌──────▼──────────────────────────────────────┐    │
│  │  사용자 서버                                  │    │
│  │  ├─ Web UI (localhost:3000)                 │    │
│  │  ├─ Socket.IO (실시간 통신)                  │    │
│  │  ├─ node-pty (가상 터미널)                   │    │
│  │  └─ AI CLI (Claude/Aider/etc)               │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

- ✅ **네트워크**: Tailscale로만 접근 (인터넷 공개 없음)
- ✅ **인증**: Tailscale Device Key
- ✅ **명령 실행**: 로컬에서만 수행
- ✅ **키 저장**: 중앙 서버 없음, 모든 키는 사용자 서버에만

---

## 🐛 문제 해결

### node-pty 설치 오류

```bash
# 빌드 도구 설치
sudo apt install -y build-essential python3

# 재설치
rm -rf node_modules
npm install
```

### Tailscale 연결 안됨

```bash
# 상태 확인
tailscale status

# 재연결
sudo tailscale down
sudo tailscale up
```

### 터미널이 느림

`config.json`에서 `workingDirectory`를 SSD 경로로 설정하세요.

---

## 📝 라이선스

MIT License

---

## 🙏 기여

이슈와 PR 환영합니다!

---

## 💡 철학

> **Your server. Your network. Your AI.**  
> **No cloud. No SSH in the browser.**

모든 제어권은 사용자에게. 클라우드 의존 없이 완전한 프라이버시.
