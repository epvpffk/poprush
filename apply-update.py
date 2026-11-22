#!/usr/bin/env python3
"""Install game files while preserving the deployed HTTP/DB performance modules."""
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent


def run(*args, **kwargs):
    return subprocess.run(list(args), check=True, capture_output=True, **kwargs)


def install():
    if os.geteuid() != 0:
        raise SystemExit("sudo -n python3 apply-update.py 로 실행하세요.")
    expected = json.loads((ROOT / "public/version.json").read_text())["version"]
    run("docker", "inspect", "colorpop")
    helper = subprocess.run(
        ["docker", "exec", "colorpop", "test", "-f", "/app/json-reply.mjs"],
        capture_output=True,
    ).returncode == 0
    original = (ROOT / "arena-api.mjs").read_text()
    api = original
    if helper:
        pattern = r'const reply = \(data, status = 200\) => Response\.json\(data, \{ status, headers: \{ [\'"]Cache-Control[\'"]: [\'"]no-store[\'"] \} \}\);'
        api, count = re.subn(pattern, "const reply = jsonReply;", api)
        if count != 1:
            raise SystemExit("API 형식 확인 실패. 실행 중인 서버는 변경하지 않았습니다.")
        api = "import {jsonReply} from './json-reply.mjs';\n" + api
    # Live score mini-boards need every participant's board.
    # Validate the built API without removing opponent arrays.
    if len(re.findall(r'board: r\.status === [\'"]waiting[\'"] \? \[\] : p\.board', api)) != 1:
        raise SystemExit("게임판 응답 형식 확인 실패. 서버는 변경하지 않았습니다.")
    for name, content in [("arena-api.mjs", api.encode()),
                          ("game.mjs", (ROOT / "game.mjs").read_bytes()),
                          ("level.mjs", (ROOT / "level.mjs").read_bytes()),
                          ("admin-test.mjs", (ROOT / "admin-test.mjs").read_bytes())]:
        run("docker", "exec", "-i", "colorpop", "node", "--input-type=module", "--check", input=content)
    backup = Path("/var/backups/poprush-game") / datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    backup.mkdir(parents=True, mode=0o700)
    for name in ["public", "arena-api.mjs", "game.mjs", "admin-test.mjs"]:
        run("docker", "cp", f"colorpop:/app/{name}", str(backup / name))
    level_exists = subprocess.run(
        ["docker", "exec", "colorpop", "test", "-f", "/app/level.mjs"], capture_output=True
    ).returncode == 0
    if level_exists:
        run("docker", "cp", "colorpop:/app/level.mjs", str(backup / "level.mjs"))
    print(f"백업 완료: {backup}", flush=True)
    with tempfile.TemporaryDirectory(prefix="poprush-game-") as folder:
        staged_api = Path(folder) / "arena-api.mjs"
        staged_api.write_text(api)
        stopped = False
        try:
            run("docker", "stop", "colorpop")
            stopped = True
            for source, target in [
                (ROOT / "public/.", "/app/public"),
                (ROOT / "migrations/.", "/app/migrations"),
                (staged_api, "/app/arena-api.mjs"),
                (ROOT / "game.mjs", "/app/game.mjs"),
                (ROOT / "level.mjs", "/app/level.mjs"),
                (ROOT / "admin-test.mjs", "/app/admin-test.mjs"),
            ]:
                src = str(source) + ("/." if source.is_dir() else "")
                run("docker", "cp", src, f"colorpop:{target}")
            run("docker", "start", "colorpop")
            port = int(run("docker", "exec", "colorpop", "node", "-p", "process.env.PORT||3000").stdout.decode().strip())
            ready = False
            for attempt in range(20):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/version.json", timeout=3) as response:
                        current = json.load(response)
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/arena", timeout=3) as response:
                        data = json.load(response)
                    if current.get("version") == expected and "ranking" in data:
                        ready = True
                        break
                except Exception:
                    pass
                time.sleep(0.5)
            if not ready:
                raise RuntimeError("시작 후 버전/API 확인 실패")
        except (Exception, KeyboardInterrupt):
            if stopped:
                print("적용 실패. 백업한 게임 파일을 복원합니다.", flush=True)
                subprocess.run(["docker", "stop", "colorpop"], capture_output=True)
                for name in ["public", "arena-api.mjs", "game.mjs", "level.mjs", "admin-test.mjs"]:
                    item = backup / name
                    if item.exists():
                        src = str(item) + ("/." if item.is_dir() else "")
                        run("docker", "cp", src, f"colorpop:/app/{name}")
                run("docker", "start", "colorpop")
            raise
    print(f"v{expected} 게임 적용 완료. 서버 실행 구조·DB 작업자·Nginx 설정 유지.", flush=True)
    print("게임 페이지에서 Ctrl+F5로 새로고침하세요.", flush=True)


if __name__ == "__main__":
    install()
