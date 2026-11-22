# 개발과 파일 관리

## 원본과 실행 파일

게임 화면은 `source/app/arena.tsx`, 공통 규칙은 `source/lib/game.ts`, 레벨 계산은 `source/lib/level.ts`에 있습니다. API 원본은 `source/app/api/`에 있으며 `source/build.mjs`가 루트 Node용 API 모듈을 생성합니다.

아래 파일은 별도로 관리합니다.

- `server.mjs`: Node HTTP 요청과 정적 파일 처리
- `database.mjs`: SQLite와 마이그레이션·쓰기 처리
- `admin-test.mjs`: 운영자 서버 권한과 테스트 기능
- `posts-api.mjs`: 게시판 서버 API
- `apply-update.py`: 기존 컨테이너에 필요한 게임 파일만 적용

`public/`과 루트 실행 모듈은 클론 직후 실행과 기존 배포 방식 때문에 추적합니다. `node_modules/`는 커밋하지 않습니다. `source/public/`과 `public/`의 동일한 음원은 Git에서 같은 blob을 공유합니다.

## 빌드

```bash
npm ci --prefix source
npm run build
npm run check
npm run smoke
```

`check`는 JavaScript 구문과 화면 진입 파일의 에셋 경로를 확인합니다. `smoke`는 별도 임시 DB와 임의 로컬 포트로 서버를 실행해 마이그레이션과 기본 API를 확인합니다. 실제 모바일 기기 조작과 대규모 부하 검증은 포함하지 않습니다.

## DB 변경

`migrations/`의 기존 SQL은 수정하지 말고 다음 번호의 새 파일을 추가하세요. SQLite가 시작할 때 `_migrations`를 확인하여 미적용 파일을 순서대로 실행합니다. 운영 DB를 Git에 올리지 마세요.

## 변경 기록

기능 변경 시 `source/public/version.json`, 화면 버전, 변경 이력을 함께 갱신하고 다시 빌드합니다. 과거 ZIP의 버전별 설명은 `docs/history/`에 보관했습니다. 과거 문서와 현재 규칙이 다르면 루트 README와 최신 버전 안내를 기준으로 합니다.
