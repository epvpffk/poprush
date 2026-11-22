# AWS 기존 컨테이너 업데이트

기존 운영 환경은 Docker 컨테이너 `colorpop`, 앱 경로 `/app`, 영구 DB 볼륨, Nginx 프록시입니다. 저장소를 업로드하거나 커밋하는 것만으로 운영 서버가 변경되지는 않습니다.

## Git으로 소스 받기

```bash
cd /home/ubuntu
git clone https://github.com/epvpffk/poprush.git
cd poprush
```

이미 클론했다면 로컬 변경을 먼저 확인한 뒤 업데이트합니다.

```bash
git status --short
git pull --ff-only
```

## 현재 운영 컨테이너에 적용

진행 중인 경기가 없는 때 저장소 루트에서 실행합니다.

```bash
sudo -n python3 apply-update.py
sudo -n docker exec colorpop cat /app/public/version.json
sudo -n docker logs --tail 40 colorpop
```

스크립트는 게임 파일을 백업한 뒤 화면·게임/API·마이그레이션·운영자 모듈을 교체합니다. 현재 컨테이너에 별도로 설치된 HTTP 연결 풀·DB 작업자·추적 모듈은 덮어쓰지 않습니다. 적용 중 잠시 중단되며 시작 후 버전과 API를 확인합니다. 실패 시 게임 파일을 복원합니다. DB 마이그레이션은 별도 변경이므로 일반 파일 백업만으로 DB를 이전 버전으로 되돌리는 기능은 아닙니다.

적용 후 PC는 Ctrl+F5, 모바일은 게임 페이지를 다시 불러옵니다. 기존 `ColorPop_Standalone.zip` 배포 흐름도 사용할 수 있으나 이 저장소에서는 압축 원본 대신 개별 소스를 관리합니다.

## 개발용 Docker 실행

```bash
docker build -t poprush:local .
docker run --name poprush-local -p 127.0.0.1:3000:3000 -v poprush-local-data:/data poprush:local
```

이 명령은 새 로컬 컨테이너를 위한 예시입니다. 운영 중인 `colorpop`을 같은 방식으로 삭제·재생성하지 마세요. 루트 Dockerfile의 기본 서버와 운영 컨테이너에 적용한 별도 성능 패치는 다를 수 있으므로 재생성할 때에는 기존 환경변수·볼륨·네트워크와 서버 도구 적용 상태를 보존해야 합니다.

## 운영자 설정

비밀번호는 서버에서 직접 입력하며 저장소에 기록하지 않습니다.

```bash
read -r -s -p "admin 비밀번호: " poprush_admin_password
echo
printf '%s' "$poprush_admin_password" | sudo -n docker exec -i colorpop node /app/setup-admin.mjs
unset poprush_admin_password
```

기존 admin 계정이 있으면 비밀번호를 변경하고 해당 계정의 세션을 해제합니다. 이미 설정된 계정을 계속 사용할 경우 이 작업을 반복할 필요는 없습니다.

## 백업

사용자 기록은 앱 소스가 아니라 `DATABASE_PATH`의 SQLite 파일과 관련 WAL 파일에 있습니다. 운영 DB 백업은 서버를 정상 종료하거나 SQLite의 적절한 백업 기능을 사용하여 일관된 상태로 수행하세요. DB·세션·운영자 지정 파일을 저장소에 커밋하지 않습니다.
