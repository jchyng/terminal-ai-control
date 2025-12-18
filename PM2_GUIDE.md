# PM2 운영 가이드

## PM2 설치

```bash
npm install -g pm2
```

## 서버 시작

### 기본 시작
```bash
npm run pm2:start
```

또는

```bash
pm2 start ecosystem.config.js
```

## 서버 관리 명령어

### 상태 확인
```bash
npm run pm2:status
# 또는
pm2 status
```

### 로그 확인
```bash
npm run pm2:logs
# 또는
pm2 logs terminal-ai-control
```

실시간 로그만 보기:
```bash
pm2 logs terminal-ai-control --lines 100
```

에러 로그만 보기:
```bash
pm2 logs terminal-ai-control --err
```

### 서버 재시작
```bash
npm run pm2:restart
# 또는
pm2 restart terminal-ai-control
```

### 무중단 재시작 (Zero-downtime reload)
```bash
npm run pm2:reload
# 또는
pm2 reload terminal-ai-control
```

### 서버 중지
```bash
npm run pm2:stop
# 또는
pm2 stop terminal-ai-control
```

### 서버 삭제
```bash
npm run pm2:delete
# 또는
pm2 delete terminal-ai-control
```

### 모니터링 대시보드
```bash
npm run pm2:monit
# 또는
pm2 monit
```

## 로그 파일 위치

모든 로그는 `logs/` 디렉토리에 저장됩니다:

- `logs/pm2-out.log` - 표준 출력 로그
- `logs/pm2-error.log` - 에러 로그
- `logs/pm2-combined.log` - 통합 로그

## 로그 로테이션

PM2는 자동으로 로그 로테이션을 수행합니다:
- 최대 파일 크기: 10MB
- 보관 파일 수: 10개
- 압축: 활성화

## 시스템 부팅 시 자동 시작

### PM2 Startup 설정
```bash
pm2 startup
```

명령어 실행 후 출력되는 명령어를 복사해서 실행하세요.

### 현재 프로세스 저장
```bash
pm2 save
```

이제 시스템이 재부팅되어도 자동으로 서버가 시작됩니다.

## 로그 구조

모든 로그는 JSON 형식으로 출력됩니다:

```json
{
  "level": "info",
  "timestamp": "2025-12-18T12:00:00.000Z",
  "message": "Client connected",
  "socketId": "abc123"
}
```

### 로그 레벨
- `info`: 일반 정보
- `warn`: 경고
- `error`: 에러
- `debug`: 디버그 (DEBUG 환경변수 설정 시)

## 디버그 모드 활성화

```bash
pm2 delete terminal-ai-control
DEBUG=true pm2 start ecosystem.config.js
```

## 유용한 PM2 명령어

### 메모리/CPU 사용량 확인
```bash
pm2 list
```

### 프로세스 정보 상세 보기
```bash
pm2 show terminal-ai-control
```

### 로그 초기화
```bash
pm2 flush terminal-ai-control
```

### 전체 프로세스 재시작
```bash
pm2 restart all
```

### 전체 프로세스 중지
```bash
pm2 stop all
```

## 트러블슈팅

### 서버가 시작되지 않을 때
```bash
# 로그 확인
pm2 logs terminal-ai-control --err

# 프로세스 삭제 후 재시작
pm2 delete terminal-ai-control
npm run pm2:start
```

### 메모리 사용량이 높을 때
```bash
# 메모리 사용량 확인
pm2 list

# 서버 재시작 (메모리 해제)
pm2 restart terminal-ai-control
```

설정 파일(ecosystem.config.js)에서 `max_memory_restart`가 500MB로 설정되어 있어, 메모리 사용량이 500MB를 초과하면 자동으로 재시작됩니다.

## 웹 모니터링 (PM2 Plus)

더 강력한 모니터링을 원한다면 PM2 Plus를 사용할 수 있습니다:

```bash
pm2 plus
```

무료 플랜으로 웹 대시보드에서 실시간 모니터링이 가능합니다.
