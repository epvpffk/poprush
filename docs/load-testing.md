# 서버 도구와 Windows 부하 시험

## 포함 버전

- `tools/server-update/`: 서버 업데이트·추적 수집 도구 v5
- `tools/windows-loadtest/`: Windows GUI/API 시험 v12

운영 서비스의 부하가 실제로 증가하므로 사용자가 관리하는 서버에서만 시험하고, 업데이트·재시작은 진행 중인 경기가 없는 때 수행하세요.

## 서버 진단

서버에 저장소를 받은 상태에서:

```bash
cd /home/ubuntu/poprush/tools/server-update
sudo -n python3 update.py
```

인자 없이 실행하면 상태를 확인합니다. 성능·추적 모듈 적용이 필요한 경우에만 `--apply`를 사용합니다. 게임 화면 적용 명령은 저장소 루트의 `apply-update.py`이며 두 명령은 역할이 다릅니다.

```bash
sudo -n python3 update.py --apply
sudo -n python3 update.py --collect --seconds 600
```

수집 종료를 요청하면 결과 ZIP이 저장될 때까지 기다립니다. `logs/`는 Git에서 제외됩니다. 도구 v5는 상대 퍼즐 배열을 유지합니다.

## Windows 실행

Node.js 24 이상을 설치하고 Windows에서 `tools/windows-loadtest/START_GUI.bat`를 실행합니다. 같은 폴더의 스크립트들은 함께 유지하세요.

명령행 예시:

```powershell
cd C:\경로\poprush\tools\windows-loadtest
node .\loadtest.mjs --url http://poprush.xyz --users 100 --rooms 50 --seconds 120 --mode battle --require-trace
```

서버 추적이 준비되어 있어야 `--require-trace` 사전 확인을 통과합니다. GUI에서는 인원·방·측정 시간을 선택할 수 있으며 `0초`는 직접 중단할 때까지 실행합니다. 오류를 무시하는 것이 아니라 자동 중단 설정과 실패 집계를 구분합니다.

현재 포함된 v12 도구는 API 응답을 측정하며 실제 브라우저 렌더링·모바일 터치·음향은 측정하지 않습니다. 5분 경기 이후에는 대전 입력보다 조회·연결 유지 부하가 중심이므로 장시간 실행 결과를 같은 강도의 지속 경기 부하로 해석하지 마세요. 대규모 인원 수용 능력은 대상 서버에서 별도로 검증해야 합니다.

세부 옵션과 과거 검증 기록은 각 도구 폴더의 `README_KO.txt`에 보관했습니다.
