# POP RUSH

같은 색 블록을 두 개 이상 터뜨리며 점수를 겨루는 무료 웹 퍼즐 게임입니다.
제작자: **루시드컴퍼니** · 서비스: [poprush.xyz](http://poprush.xyz)

이 저장소는 보관된 **게임 v59**, 서버 관리 도구 **v5**, Windows 부하 시험 도구 **v12**를 기준으로 정리했습니다. 저장소를 갱신해도 운영 중인 AWS 서버에 자동 배포되지는 않습니다.

## 주요 기능

- 친구 초대 코드와 비밀번호를 사용하는 최대 8인 대전방
- 4·5·6색 선택 및 같은 색상 수를 선택한 비슷한 레벨끼리 1대1 자동 매칭
- 1~200레벨, 대전 블록 점수 기반 XP, 10레벨 단위 배지 색상
- 다섯 난이도의 AI 및 별도 AI 랭킹, 일반 TOP 100을 10명씩 표시
- 자유 플레이, 공지사항, 버그·건의 게시판, 운영자 전용 테스트
- 상대 퍼즐과 라이브 점수 표시, 경기 결과와 계정 기록 저장
- 모바일·PC 탭 이탈 시 기권, 메뉴·경기별 음악과 효과음

최신 규칙: 기권자를 뒤로 배치하고 **점수 높은 순 → 남은 블록 적은 순 → 클리어·종료 시간 빠른 순**으로 경기 순위를 정합니다. 콤보 연결 시간은 2초이며 오클릭은 콤보만 초기화합니다. 오클릭 시간 차감과 유예 횟수는 v59에서 제거했습니다. 경험치는 로그인 계정의 사람·AI 대전 점수 500점당 1XP이며 자유 플레이에서는 지급하지 않습니다.

## 빠른 실행

Node.js **24 이상**이 필요합니다. 빌드된 화면과 음원이 포함되어 있어 실행만 할 때에는 npm 설치가 필요 없습니다.

```bash
git clone https://github.com/epvpffk/poprush.git
cd poprush
npm start
```

브라우저에서 `http://localhost:3000`을 엽니다. 기본 DB는 `data/colorpop.sqlite`에 생성되며 이 폴더는 Git에서 제외됩니다.

## 개발·검증

```bash
npm ci --prefix source
npm run build
npm run check
npm run smoke
```

화면과 공통 게임 규칙의 원본은 `source/`에 있습니다. `npm run build`는 `public/`과 루트의 일부 서버 모듈을 다시 생성하므로 원본과 생성물을 함께 커밋하세요. 직접 관리하는 `admin-test.mjs`, `posts-api.mjs`, `database.mjs`, `server.mjs` 등은 이 빌드로 생성되지 않습니다.

## 저장소 구성

| 경로 | 내용 |
| --- | --- |
| `source/` | React/TypeScript 화면, 게임 규칙, API 원본과 빌드 설정 |
| `public/` | 바로 실행할 수 있는 빌드된 화면과 음악·효과음 |
| 루트 `*.mjs` | Node HTTP 서버, API, 계정·DB·게임 모듈 |
| `migrations/` | 기존 데이터를 보존하는 순차 DB 변경 SQL |
| `apply-update.py` | 기존 Docker 컨테이너의 게임 파일 갱신 |
| `tools/server-update/` | 연결 풀·DB 작업자·응답 전달·진단 수집 도구 |
| `tools/windows-loadtest/` | Windows PowerShell GUI와 Node API 부하 시험 |
| `docs/` | 개발, AWS 배포, 부하 시험 및 변경 이력 |

## 안내 문서

- [개발·구조](docs/development.md)
- [AWS 기존 서버 업데이트](docs/deployment.md)
- [서버 진단·Windows 부하 시험](docs/load-testing.md)
- [변경 이력](CHANGELOG.md)
- [음악·효과음 출처](docs/assets.md)
- [과거 업데이트 원문](docs/history/)

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP 수신 포트 |
| `DATABASE_PATH` | `data/colorpop.sqlite` | SQLite DB 경로 |
| `PUBLIC_ORIGIN` | 요청에서 계산 | 운영 서비스의 외부 주소 |
| `TRUST_PROXY` | `false` | 신뢰하는 프록시의 HTTPS 전달 정보 사용; Dockerfile은 `true` |

환경변수는 실제 프로세스나 Docker 실행 설정에 지정하세요. 기본 실행기는 `.env` 파일을 자동으로 읽지 않습니다. `.env.example`은 이름과 형식을 보여 주는 예시입니다.

운영자 계정은 비밀번호가 동봉되어 있지 않습니다. [배포 문서](docs/deployment.md)의 명령으로 서버에서 설정합니다. 계정 DB·세션·로그·키·운영자 지정 파일은 저장소에 포함하지 않습니다.

## 라이선스·에셋

별도의 오픈소스 라이선스를 지정하지 않았습니다. 음원 등 제3자 에셋은 각 출처의 조건을 따릅니다. 사용자 제공 효과음의 출처·라이선스 확인 상태는 [에셋 문서](docs/assets.md)에 기록했습니다.
