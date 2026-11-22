# POP RUSH 100명 동시접속 테스트

이 도구는 Node.js 24에서 실행합니다. 게임 서버와 다른 PC에서 실행해야 서버 성능과 부하 발생기 성능이 섞이지 않습니다. 허가된 본인 서버를 대상으로만 사용하세요.
운영 서버 테스트는 실제 접속자에게 지연을 줄 수 있으므로 한가한 시간에 진행하세요. 테스트용 게스트와 방은 DB에 남을 수 있습니다. 계정 랭킹에는 집계하지 않으며 기존 데이터를 삭제하지 않습니다.

## 두 종류
- browse: 메뉴 API를 사용자별 약 2.5초 간격으로 조회합니다.
- battle: 게스트를 만들고 최대 8명씩 균등하게 방에 나눠 입장, 경기 시작, 사용자별 최대 초당 2회 블록 제거, 초당 1회 방 조회, 5초마다 heartbeat를 보냅니다. 100명은 13개 방입니다. AI는 사용하지 않습니다.

## 실행
압축을 푼 ColorPop_Standalone 폴더에서 터미널을 엽니다. Node.js 24가 필요합니다. URL은 실제 게임 주소로 바꾸세요.

```bash
node loadtest.mjs --url http://poprush.xyz --users 10 --seconds 60 --mode battle
node loadtest.mjs --url http://poprush.xyz --users 25 --seconds 60 --mode battle
node loadtest.mjs --url http://poprush.xyz --users 50 --seconds 90 --mode battle
node loadtest.mjs --url http://poprush.xyz --users 100 --seconds 120 --mode battle
```
위 네 명령을 한꺼번에 실행하지 마세요. 각 단계 결과를 확인하고 실패하면 다음 단계로 넘어가지 않습니다.
메뉴 접속만 비교할 때:
```bash
node loadtest.mjs --url http://poprush.xyz --users 100 --seconds 60 --mode browse
```
도구는 최대 100명·180초로 제한합니다. Ctrl+C로 중단하면 진행 요청 종료 후 방 나가기를 시도합니다. 측정 요청이 100건을 넘고 실패가 20건 이상이며 오류율이 5%를 넘으면 자동 중단합니다. 네트워크 강제 종료 시 정리는 보장하지 않습니다.

## 서버 모니터링
AWS 터미널에서 별도로 실행:
```bash
sudo docker stats colorpop
```
최근 오류 확인:
```bash
sudo docker logs --since 10m --tail 100 colorpop
```
응답 JSON의 `failureRate`, `byEndpoint.move.p95`, `byEndpoint.poll.p95`와 CPU/메모리를 같이 봅니다. 시작 목표는 오류율 1% 미만·각 API p95 500ms 미만입니다. 이는 임시 목표이며 실제 게임 체감과 환경에 맞춰 조정합니다. 오류·타임아웃·동기화 오류가 나면 다음 단계 대신 원인을 확인하세요. `initialTargetPass`는 초기 API 기준 통과 여부이며 실제 100명 브라우저 체감 성능을 보증하지 않습니다.

## 범위와 한계
도구는 API 부하만 측정합니다. 실제 브라우저 렌더링, 손가락 입력, 음악/이미지 동시 다운로드, 로그인 비밀번호 검증 부하, AI 판단 연산은 포함하지 않습니다. 부하를 주는 동안 실제 휴대폰/PC로 한 판을 해보며 입력 지연·점수 되돌아감·방 이탈을 함께 확인하세요. AWS 요금·네트워크·프록시·TLS 설정과 인스턴스 사양이 달라지면 결과도 달라집니다.

8명·5초 로컬 스모크 테스트에서 API 84건, 실패 0건으로 도구 동작을 확인했습니다. AWS 서버에서 100명 테스트를 실행한 결과는 아닙니다.
