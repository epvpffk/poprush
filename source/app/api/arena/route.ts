import { timed, addTiming } from "../../../lib/performance";
import { env } from "cloudflare:workers";
import { getIdentity, currentAccount } from "../../../lib/account";
import {
  begin,
  player,
  returnToLobby,
  settleLobby,
  performInput,
  playerDeadline,
  boardHash,
  tick,
  normalizeRoomRules,
  type Room,
} from "../../../lib/game";
import { MAX_XP, progressFromXp, xpFromBlockScore } from "../../../lib/level";
export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
function db() {
  if (!env.DB)
    throw new Error("경기 저장소를 준비 중입니다. 잠시 후 다시 시도해 주세요.");
  return env.DB;
}
async function identity(req: Request) {
  let id = await timed("auth", () => getIdentity(req));
  if (!id) throw new Error("로그인이 필요합니다.");
  return id;
}
async function passwordHash(password: string, salt: string) {
  let encoder = new TextEncoder();
  let key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  let bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function profile(id: string) {
  let row = await db()
    .prepare("SELECT * FROM profiles WHERE id=?")
    .bind(id)
    .first<{ id: string; nickname: string }>();
  return row;
}
async function playerProgress(id: string) {
  let row = await db()
    .prepare("SELECT xp FROM player_progress WHERE user=?")
    .bind(id)
    .first<{ xp: number }>();
  return progressFromXp(row?.xp || 0);
}
function firstSeat(r: Room) {
  let occupied = new Set(r.players.map((p) => p.seat));
  for (let seat = 0; seat < Math.max(2, r.maxPlayers || 8); seat++)
    if (!occupied.has(seat)) return seat;
  throw new Error("빈 참가칸이 없습니다.");
}
async function load(code: string) {
  let row = await db()
    .prepare("SELECT state,version FROM rooms WHERE code=?")
    .bind(code)
    .first<{ state: string; version: number }>();
  if (!row) throw new Error("방을 찾을 수 없습니다. 방 코드를 확인해 주세요.");
  let r = normalizeRoomRules(JSON.parse(row.state) as Room);
  for (let p of r.players) if (p.seat === undefined) p.seat = firstSeat(r);
  r.version = row.version;
  return r;
}
async function persistResults(r: Room) {
  if (r.status === "waiting" || (r.practice && !r.aiRankingEnabled)) return;
  let humans = r.players.filter(
    (p) =>
      !p.ai &&
      !p.id.startsWith("guest-") &&
      (r.status === "finished" || p.forfeit),
  );
  let statements: any[] = [];
  if (r.practice) {
    let bots = r.players.filter((p) => p.ai);
    if (bots.length) {
      let level = Math.max(...bots.map((p) => p.aiLevel ?? 2));
      for (let p of humans) {
        let outcome = !p.forfeit && p.outcome === "win" ? "win" : "loss";
        statements.push(
          db()
            .prepare(
              "INSERT OR IGNORE INTO ai_results(room,user,bot,level,outcome,score,created) VALUES(?,?,?,?,?,?,?)",
            )
            .bind(
              r.matchId || r.code,
              p.id,
              "match",
              level,
              outcome,
              p.score,
              r.finishedAt || Date.now(),
            ),
        );
        statements.push(
          db()
            .prepare(
              "INSERT INTO player_progress(user,xp,updated) SELECT ?,?,? WHERE changes()>0 ON CONFLICT(user) DO UPDATE SET xp=MIN(?,player_progress.xp+excluded.xp),updated=excluded.updated",
            )
            .bind(
              p.id,
              xpFromBlockScore(p.score),
              r.finishedAt || Date.now(),
              MAX_XP,
            ),
        );
      }
    }
  } else
    for (let p of humans) {
      statements.push(
        db()
          .prepare(
            "INSERT OR IGNORE INTO results(room,user,outcome,score,remaining,created) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            r.matchId || r.code,
            p.id,
            p.forfeit ? "loss" : p.outcome,
            p.score,
            p.remaining,
            r.finishedAt || Date.now(),
          ),
      );
      statements.push(
        db()
          .prepare(
            "INSERT INTO player_progress(user,xp,updated) SELECT ?,?,? WHERE changes()>0 ON CONFLICT(user) DO UPDATE SET xp=MIN(?,player_progress.xp+excluded.xp),updated=excluded.updated",
          )
          .bind(
            p.id,
            xpFromBlockScore(p.score),
            r.finishedAt || Date.now(),
            MAX_XP,
          ),
      );
    }
  if (statements.length) await db().batch(statements);
}
async function save(r: Room) {
  let prev = r.version;
  r.version++;
  let result = await db()
    .prepare(
      "UPDATE rooms SET state=?,version=?,updated=? WHERE code=? AND version=?",
    )
    .bind(JSON.stringify(r), r.version, Date.now(), r.code, prev)
    .run();
  return result.meta.changes === 1;
}
async function mutateUnlocked(code: string, fn: (r: Room) => void) {
  for (let i = 0; i < 6; i++) {
    let r = await load(code);
    const before = JSON.stringify(r);
    tick(r, Date.now());
    if (r.status === "finished") await persistResults(r);
    fn(r);
    settleLobby(r, Date.now());
    if (JSON.stringify(r) === before) return r;
    if (await save(r)) {
      await persistResults(r);
      return r;
    }
  }
  throw new Error("다른 참가자의 동작을 처리 중입니다. 다시 시도해 주세요.");
}
const roomOperations = new Map<string, Promise<unknown>>();
function mutate(code: string, fn: (r: Room) => void) {
  const queuedAt = performance.now();
  const previous = roomOperations.get(code) || Promise.resolve();
  const result = previous
    .catch(() => {})
    .then(() => {
      addTiming("room_wait", performance.now() - queuedAt);
      return timed("room_work", () => mutateUnlocked(code, fn));
    });
  roomOperations.set(code, result);
  void result
    .finally(() => {
      if (roomOperations.get(code) === result) roomOperations.delete(code);
    })
    .catch(() => {});
  return result;
}
export async function settleInactiveRooms() {
  let q = await db()
    .prepare(
      "SELECT code FROM rooms WHERE json_extract(state,'$.status')='playing' AND updated<? ORDER BY updated ASC LIMIT 50",
    )
    .bind(Date.now() - 20000)
    .all<{ code: string }>();
  for (let row of q.results) {
    try {
      await mutate(row.code, () => {});
    } catch {}
  }
}
function view(r: Room, id: string) {
  normalizeRoomRules(r);
  let mine = r.players.find((p) => p.id === id);
  if (!mine) throw new Error("이 방의 참가자가 아닙니다.");
  let { passwordHash: secret, passwordSalt: salt, ...publicRoom } = r;
  const returning = !r.matchmaking && r.status === "finished" && mine.lobbyReady;
  return {
    ...publicRoom,
    ...(returning ? { status: "waiting", awaitingReturn: true } : {}),
    locked: !!secret,
    host: r.host === id ? "me" : "other",
    players: r.players.map((p) => ({
      ...p,
      level: p.level || 1,
        xpEarned:
          r.status === "finished" && !p.ai && !p.id.startsWith("guest-")
            ? xpFromBlockScore(p.score)
            : 0,
      id:
        p.id === id
          ? "me"
          : p.ai
            ? "ai" + r.players.indexOf(p)
            : String(r.players.indexOf(p)),
      board: r.status === "waiting" ? [] : p.board,
    })),
  };
}
async function rank() {
  let q = await db()
    .prepare(
      `SELECT p.id,p.nickname,COALESCE(pp.xp,0) AS xp,COUNT(r.room) AS games,SUM(CASE WHEN r.outcome='win' THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN r.outcome='loss' THEN 1 ELSE 0 END) AS losses,SUM(CASE WHEN r.outcome='draw' THEN 1 ELSE 0 END) AS draws,MAX(r.score) AS best,MAX(0,SUM(CASE WHEN r.outcome='win' THEN 30 WHEN r.outcome='loss' THEN -10 ELSE 0 END)) AS points FROM profiles p JOIN results r ON p.id=r.user LEFT JOIN player_progress pp ON pp.user=p.id WHERE NOT EXISTS (SELECT 1 FROM accounts owner WHERE owner.id=p.id AND owner.username='admin') GROUP BY p.id ORDER BY points DESC,wins DESC,best DESC,p.created ASC,p.id ASC LIMIT 100`,
    )
    .all();
  return q.results.map((row: any) => ({
    ...row,
    progress: progressFromXp(row.xp),
  }));
}
function matchingRange(joined: number, now: number) {
  let waited = Math.max(0, now - joined);
  return waited >= 60000
    ? 199
    : Math.min(30, 5 + Math.floor(waited / 10000) * 5);
}
let matchmakingChain: Promise<unknown> = Promise.resolve();
function serializedMatchmaking<T>(work: () => Promise<T>) {
  let run = matchmakingChain.catch(() => {}).then(work);
  matchmakingChain = run;
  return run;
}
async function matchmaking(id: string, nickname: string, now: number, colorCount: number) {
  if(![4,5,6].includes(colorCount))throw new Error('실시간 대전은 4·5·6가지 색상 중에서 선택해 주세요.');
  return serializedMatchmaking(async () => {
    await db().batch([
      db()
        .prepare("DELETE FROM matchmaking_queue WHERE seen<?")
        .bind(now - 15000),
      db()
        .prepare("DELETE FROM matchmaking_matches WHERE created<?")
        .bind(now - 1200000),
    ]);
    let matched = await db()
      .prepare("SELECT room FROM matchmaking_matches WHERE user=?")
      .bind(id)
      .first<{ room: string }>();
    if (matched) {
      try {
        let existing = await mutate(matched.room, () => {});
        if (existing.status === "playing" && existing.players.some((p) => p.id === id && !p.forfeit))
          return { status: "matched", room: view(existing, id) };
      } catch {}
      await db()
        .prepare("DELETE FROM matchmaking_matches WHERE user=?")
        .bind(id)
        .run();
    }
    let progress = await playerProgress(id),
      old = await db()
        .prepare("SELECT joined,ticket,colors FROM matchmaking_queue WHERE user=?")
        .bind(id)
        .first<{ joined: number; ticket: string; colors:number }>(),
      joined = old?.colors===colorCount ? old.joined : now,
      ticket = old?.colors===colorCount ? old.ticket : crypto.randomUUID();
    await db()
      .prepare(
        "INSERT INTO matchmaking_queue(user,ticket,level,joined,seen,colors) VALUES(?,?,?,?,?,?) ON CONFLICT(user) DO UPDATE SET ticket=excluded.ticket,level=excluded.level,joined=excluded.joined,seen=excluded.seen,colors=excluded.colors",
      )
      .bind(id, ticket, progress.level, joined, now, colorCount)
      .run();
    let queue = await db()
      .prepare(
        "SELECT q.user,q.level,q.joined,p.nickname FROM matchmaking_queue q JOIN profiles p ON p.id=q.user WHERE q.user<>? AND q.colors=? ORDER BY q.joined ASC LIMIT 200",
      )
      .bind(id, colorCount)
      .all<{ user: string; level: number; joined: number; nickname: string }>();
    let mineRange = matchingRange(joined, now),
      candidate = queue.results
        .map((other) => ({
          ...other,
          difference: Math.abs(other.level - progress.level),
          range: matchingRange(other.joined, now),
        }))
        .filter((other) => other.difference <= Math.max(mineRange, other.range))
        .sort((a, b) => a.difference - b.difference || a.joined - b.joined)[0];
    if (!candidate)
      return {
        status: "waiting",
        colors: colorCount,
        level: progress.level,
        range: mineRange,
        waitSeconds: Math.floor((now - joined) / 1000),
      };
    let code = crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 8)
        .toUpperCase(),
      r: Room = {
        matchmaking: true,
        matchId: crypto.randomUUID(),
        refillMode: true,
        title: `${colorCount}색 실시간 레벨 매칭`,
        colors: colorCount,
        maxPlayers: 2,
        durationSeconds: 180,
        code,
        host: candidate.user,
        status: "waiting",
        players: [
          {
            ...player(candidate.user, candidate.nickname, now),
            seat: 0,
            level: candidate.level,
          },
          { ...player(id, nickname, now), seat: 1, level: progress.level },
        ],
        created: now,
        startAt: 0,
        endAt: 0,
        practice: false,
        finishedAt: 0,
        version: 0,
      };
    begin(r, now, crypto.getRandomValues(new Uint32Array(1))[0]);
    await db().batch([
      db()
        .prepare(
          "INSERT INTO rooms(code,state,version,updated) VALUES(?,?,0,?)",
        )
        .bind(code, JSON.stringify(r), now),
      db()
        .prepare("DELETE FROM matchmaking_queue WHERE user IN (?,?)")
        .bind(id, candidate.user),
      db()
        .prepare(
          "INSERT OR REPLACE INTO matchmaking_matches(user,room,created) VALUES(?,?,?)",
        )
        .bind(id, code, now),
      db()
        .prepare(
          "INSERT OR REPLACE INTO matchmaking_matches(user,room,created) VALUES(?,?,?)",
        )
        .bind(candidate.user, code, now),
    ]);
    return { status: "matched", room: view(r, id) };
  });
}
// Collapse historical opponent rows to one result per player and match.
const aiMatches = `WITH ai_matches AS (SELECT a.room,a.user,MAX(a.level) AS level,
CASE WHEN MAX(CASE WHEN a.bot='match' THEN 1 ELSE 0 END)=1 THEN MAX(CASE WHEN a.bot='match' THEN a.outcome END)
ELSE COALESCE((SELECT CASE WHEN json_extract(p.value,'$.forfeit')=1 THEN 'loss' ELSE json_extract(p.value,'$.outcome') END FROM rooms r,json_each(r.state,'$.players') p WHERE r.code=a.room AND json_extract(p.value,'$.id')=a.user LIMIT 1),CASE WHEN MIN(CASE WHEN a.outcome='win' THEN 1 ELSE 0 END)=1 THEN 'win' ELSE 'loss' END) END AS outcome,
MAX(a.score) AS score,MAX(a.created) AS created FROM ai_results a GROUP BY a.room,a.user)`;
async function aiRanking(id: string | null) {
  let rankings: any[][] = [];
  for (let level = 0; level < 5; level++) {
    let q = await db()
      .prepare(
        aiMatches +
          ` SELECT p.id,p.nickname,COUNT(*) AS games,SUM(CASE WHEN a.outcome='win' THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN a.outcome='loss' THEN 1 ELSE 0 END) AS losses,MAX(a.score) AS best,MAX(0,SUM(CASE WHEN a.outcome='win' THEN 30 ELSE -10 END)) AS points FROM ai_matches a JOIN profiles p ON p.id=a.user WHERE a.level=? AND NOT EXISTS (SELECT 1 FROM accounts owner WHERE owner.id=p.id AND owner.username='admin') GROUP BY p.id ORDER BY points DESC,wins DESC,best DESC,p.created ASC,p.id ASC LIMIT 100`,
      )
      .bind(level)
      .all();
    rankings.push(
      q.results.map((p: any, i: number) => ({
        ...p,
        id: undefined,
        me: p.id === id,
        rank: i + 1,
      })),
    );
  }
  let stats = id
    ? (
        await db()
          .prepare(
            aiMatches +
              ` SELECT level,COUNT(*) games,SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) wins,SUM(CASE WHEN outcome='loss' THEN 1 ELSE 0 END) losses,MAX(0,SUM(CASE WHEN outcome='win' THEN 30 ELSE -10 END)) points FROM ai_matches WHERE user=? GROUP BY level`,
          )
          .bind(id)
          .all()
      ).results
    : [];
  return { aiRanking: rankings, aiStats: stats };
}
export async function GET(req: Request) {
  try {
    let id = await timed("auth", () => getIdentity(req)),
      u = new URL(req.url),
      code = u.searchParams.get("room");
    if (code) {
      if (!id) throw new Error("로그인이 필요합니다.");
      code = code.toUpperCase();
      let raw = await load(code);
      if (!raw.players.some((p) => p.id === id))
        throw new Error("이 방의 참가자가 아닙니다.");
      const before = JSON.stringify(raw),
        now = Date.now();
      const mine = raw.players.find((p) => p.id === id)!;
      tick(raw, now);
      settleLobby(raw, now);
      // Return only committed state. Actual state transitions still use the room queue.
      if (now - mine.seen < 5000 && JSON.stringify(raw) === before)
        return reply({ room: view(raw, id), serverNow: Date.now() });
      let r = await mutate(code, (r) => {
        let p = r.players.find((p) => p.id === id);
        if (p && Date.now() - p.seen >= 5000) p.seen = Date.now();
      });
      return reply({ room: view(r, id), serverNow: Date.now() });
    }
    const account = await currentAccount(req);
    await settleInactiveRooms();
    if (!id) {
      let ranking = await rank();
      return reply({
        ...(await aiRanking(null)),
        account: null,
        profile: null,
        progress: progressFromXp(0),
        ranking: ranking.map((x: any, i: number) => ({
          ...x,
          id: undefined,
          me: false,
          rank: i + 1,
        })),
        stats: null,
        soloBest: 0,
        history: { battles: [], solo: [] },
        serverNow: Date.now(),
      });
    }
    let p = await profile(id);
    let ranking = await rank(),
      progress = await playerProgress(id);
    let myStats: any = await db()
      .prepare(
        "SELECT COUNT(*) AS games,SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) AS wins,SUM(CASE WHEN outcome='loss' THEN 1 ELSE 0 END) AS losses,SUM(CASE WHEN outcome='draw' THEN 1 ELSE 0 END) AS draws,MAX(0,SUM(CASE WHEN outcome='win' THEN 30 WHEN outcome='loss' THEN -10 ELSE 0 END)) AS points FROM results WHERE user=?",
      )
      .bind(id)
      .first();
    myStats = {
      ...(myStats || {}),
      rank: Math.max(0, ranking.findIndex((x: any) => x.id === id) + 1) || null,
    };
    let solo = await db()
      .prepare("SELECT MAX(score) AS best FROM solo_results WHERE user=?")
      .bind(id)
      .first<{ best: number }>();
    let battles = await db()
      .prepare(
        "SELECT room,outcome,score,remaining,created FROM results WHERE user=? ORDER BY created DESC LIMIT 20",
      )
      .bind(id)
      .all();
    let soloHistory = await db()
      .prepare(
        "SELECT score,remaining,elapsed,created FROM solo_results WHERE user=? ORDER BY created DESC LIMIT 20",
      )
      .bind(id)
      .all();
    return reply({
      ...(await aiRanking(id)),
      account: account ? { username: account.username } : null,
      soloBest: solo?.best || 0,
      history: { battles: battles.results, solo: soloHistory.results },
      profile: p ? { nickname: p.nickname } : null,
      progress,
      ranking: ranking.map((x: any, i: number) => ({
        ...x,
        id: undefined,
        me: x.id === id,
        rank: i + 1,
      })),
      stats: myStats,
      serverNow: Date.now(),
    });
  } catch (e) {
    let m = e instanceof Error ? e.message : "요청을 처리하지 못했습니다.";
    return reply({ error: m }, m.includes("로그인") ? 401 : 400);
  }
}
export async function POST(req: Request) {
  try {
    let origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin)
      return reply({ error: "허용되지 않은 요청입니다." }, 403);
    let id = await identity(req),
      data = (await req.json()) as any,
      now = Date.now();
    if (data.action === "solo_result") {
      if (id.startsWith("guest-")) return reply({ ok: true });
      let run = String(data.run || ""),
        score = Number(data.score),
        remaining = Number(data.remaining),
        elapsed = Number(data.elapsed);
      if (
        !/^[a-zA-Z0-9-]{16,64}$/.test(run) ||
        !Number.isInteger(score) ||
        score < 0 ||
        score > 10000000 ||
        !Number.isInteger(remaining) ||
        remaining < 0 ||
        remaining > 100 ||
        !Number.isInteger(elapsed) ||
        elapsed < 0 ||
        elapsed > 300
      )
        throw new Error("잘못된 자유 플레이 결과입니다.");
      await db()
        .prepare(
          "INSERT OR IGNORE INTO solo_results(run,user,score,remaining,elapsed,created) VALUES(?,?,?,?,?,?)",
        )
        .bind(run, id, score, remaining, elapsed, now)
        .run();
      return reply({ ok: true });
    }
    if (data.action === "profile") {
      let name = String(data.nickname || "").trim();
      if (name.length < 2 || name.length > 16 || /[<>\x00-\x1f]/.test(name))
        throw new Error("닉네임은 2~16자로 입력해 주세요.");
      await db()
        .prepare(
          "INSERT INTO profiles(id,nickname,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname",
        )
        .bind(id, name, now)
        .run();
      return reply({ ok: true, profile: { nickname: name } });
    }
    let p = await profile(id);
    if (!p) throw new Error("먼저 닉네임을 저장해 주세요.");
    if (data.action === "matchmaking_cancel") {
      await db()
        .prepare("DELETE FROM matchmaking_queue WHERE user=?")
        .bind(id)
        .run();
      return reply({ matchmaking: { status: "cancelled" } });
    }
    if (data.action === "matchmaking") {
      const result = await matchmaking(id, p.nickname, now, Number(data.colors ?? 4));
      return reply({ matchmaking: result, serverNow: Date.now() });
    }
    if (data.action === "create") {
      let title = String(data.title ?? "POP RUSH 대전방").trim(),
        colorCount = Number(data.colors ?? 4),
        maxPlayers = Number(data.maxPlayers ?? 8),
        durationSeconds = Number(data.durationSeconds ?? 180),
        password = String(data.password || "");
      if (title.length < 2 || title.length > 32 || /[<>\x00-\x1f]/.test(title))
        throw new Error("방 제목은 2~32자로 입력해 주세요.");
      if (!Number.isInteger(colorCount) || colorCount < 3 || colorCount > 6)
        throw new Error("블록 색상 수는 3~6가지로 선택해 주세요.");
      if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 8)
        throw new Error("최대 인원은 1~8명으로 선택해 주세요.");
      if (![180, 300].includes(durationSeconds))
        throw new Error("지원하지 않는 제한 시간입니다.");
      if (password && (password.length < 4 || password.length > 32))
        throw new Error("방 비밀번호는 4~32자로 입력해 주세요.");
      let active = await db()
        .prepare(
          "SELECT state FROM rooms WHERE updated>? ORDER BY updated DESC LIMIT 100",
        )
        .bind(now - 240000)
        .all<{ state: string }>();
      for (let row of active.results) {
        let old = JSON.parse(row.state) as Room;
        if (
          old.status !== "finished" &&
          old.players.some((x) => x.id === id && !x.forfeit)
        )
          return reply({ room: view(old, id), serverNow: now });
      }
      let code = crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 8)
        .toUpperCase();
      let salt = password ? crypto.randomUUID() : undefined;
      let secret = password ? await passwordHash(password, salt!) : undefined;
      const ownerProgress = await playerProgress(id);
      let r: Room = {
        refillMode: data.refillMode !== false,
        title,
        colors: colorCount,
        maxPlayers,
        durationSeconds,
        passwordHash: secret,
        passwordSalt: salt,
        code,
        host: id,
        status: "waiting",
        players: [
          { ...player(id, p.nickname, now), seat: 0, level: ownerProgress.level },
        ],
        created: now,
        startAt: 0,
        endAt: 0,
        practice: false,
        finishedAt: 0,
        version: 0,
      };
      await db()
        .prepare(
          "INSERT INTO rooms(code,state,version,updated) VALUES(?,?,0,?)",
        )
        .bind(code, JSON.stringify(r), now)
        .run();
      return reply({ room: view(r, id), serverNow: now });
    }
    let code = String(data.code || "")
      .trim()
      .toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(code))
      throw new Error("8자리 방 코드를 입력해 주세요.");
    if (data.action === "join") {
      let target = await load(code);
      if (!target.players.some((p) => p.id === id) && target.passwordHash) {
        let candidate = String(data.password || "");
        if (
          candidate.length > 32 ||
          (await passwordHash(candidate, target.passwordSalt!)) !==
            target.passwordHash
        )
          throw new Error("방 비밀번호가 올바르지 않습니다.");
      }
    }
    const joiningProgress =
      data.action === "join" ? await playerProgress(id) : null;
    let r = await mutate(code, (r) => {
      let self = r.players.find((x) => x.id === id);
      if (data.action === "join") {
        if (self) {
          self.seen = now;
          if (r.status === "finished") returnToLobby(r, id, now);
          return;
        }
        if (r.status === "finished")
          throw new Error(
            "경기가 종료되어 참가자들이 결과를 확인 중입니다. 방장이 대기실로 복귀한 뒤 다시 입장해 주세요.",
          );
        if (r.status !== "waiting")
          throw new Error(
            "이미 진행 중인 경기입니다. 다음 대기실에서 입장해 주세요.",
          );
        if (r.players.length >= (r.maxPlayers || 8))
          throw new Error(`정원 ${r.maxPlayers || 8}명이 모두 찼습니다.`);
        r.players.push({
          ...player(id, p!.nickname, now),
          seat: firstSeat(r),
          level: joiningProgress!.level,
        });
        return;
      }
      if (!self && data.action === "leave") return;
      if (!self) throw new Error("참가자만 사용할 수 있습니다.");
      self.seen = now;
      if (["add_ai", "set_ai", "remove_ai"].includes(data.action)) {
        if (r.host !== id) throw new Error("방장만 AI를 설정할 수 있습니다.");
        if (r.status !== "waiting")
          throw new Error("대기 중에만 AI를 설정할 수 있습니다.");
        let index = Number(data.index),
          level = Number(data.level ?? 1);
        if (!Number.isInteger(level) || level < 0 || level > 4)
          throw new Error("AI 난이도를 확인해 주세요.");
        if (data.action === "add_ai") {
          let cap = Math.max(2, r.maxPlayers || 8);
          if (r.players.length >= cap) throw new Error("빈 참가칸이 없습니다.");
          let seat = data.seat === undefined ? firstSeat(r) : Number(data.seat);
          if (!Number.isInteger(seat) || seat < 0 || seat >= cap)
            throw new Error("참가칸 번호를 확인해 주세요.");
          if (r.players.some((p) => p.seat === seat))
            throw new Error("이미 사용 중인 참가칸입니다.");
          let bot = player("AI-" + crypto.randomUUID(), "컬러봇", now, true);
          bot.seat = seat;
          bot.aiLevel = level;
          bot.name =
            "컬러봇 · " + ["초급", "중급", "고급", "매니아", "신"][level];
          r.players.push(bot);
        } else {
          let bot =
            data.seat === undefined
              ? r.players[index]
              : r.players.find((p) => p.seat === Number(data.seat));
          if (!bot?.ai) throw new Error("AI 참가자를 선택해 주세요.");
          if (data.action === "remove_ai")
            r.players = r.players.filter((p) => p.id !== bot.id);
          else {
            bot.aiLevel = level;
            bot.name =
              "컬러봇 · " + ["초급", "중급", "고급", "매니아", "신"][level];
          }
        }
        return;
      }
      if (data.action === "start") {
        if (r.host !== id) throw new Error("방장만 시작할 수 있습니다.");
        if (r.status !== "waiting") throw new Error("이미 시작한 경기입니다.");
        r.matchId = crypto.randomUUID();
        begin(r, now, crypto.getRandomValues(new Uint32Array(1))[0]);
      } else if (data.action === "return_to_lobby") {
        returnToLobby(r, id, now);
      } else if (data.action === "heartbeat") {
        if (!self.forfeit) {
          self.connectionTracked = true;
          self.seen = now;
        }
      } else if (data.action === "move") {
        if (
          r.status !== "playing" ||
          now < r.startAt ||
          now >= playerDeadline(r, self)
        )
          throw new Error("진행 중인 경기에서만 움직일 수 있습니다.");
        if (data.seq !== undefined) {
          if (!Number.isInteger(data.seq) || data.seq < 0)
            throw new Error("잘못된 입력 순서입니다.");
          if (data.seq < (self.moveSeq || 0)) return;
          if (data.seq !== (self.moveSeq || 0))
            throw new Error("게임판을 동기화하고 있습니다. 다시 눌러 주세요.");
        }
        if (
          data.boardHash !== undefined &&
          data.boardHash !== boardHash(self.board)
        )
          throw new Error("게임판이 바뀌었습니다. 화면을 갱신합니다.");
        if (self.done || self.forfeit)
          throw new Error("이미 플레이를 마쳤습니다.");
        performInput(self, data.index, now, r);
        tick(r, now);
      } else if (data.action === "leave") {
        if (r.status === "waiting") {
          r.players = r.players.filter((x) => x.id !== id);
          if (r.host === id) r.host = r.players.find((p) => !p.ai)?.id || "";
          if (!r.players.some((p) => !p.ai)) {
            r.status = "finished";
            r.practice = true;
            r.finishedAt = now;
          }
        } else if (r.status === "finished") {
          r.players = r.players.filter((p) => p.id !== id);
          if (r.host === id) r.host = r.players.find((p) => !p.ai)?.id || "";
        } else if (r.status === "playing") {
          self.forfeit = true;
          self.done = true;
          self.outcome = "loss";
          self.lastMove = now;
          tick(r, now);
        }
      } else throw new Error("알 수 없는 동작입니다.");
    });
    if (data.action === "leave" || (data.action === "return_to_lobby" && r.matchmaking)) {
      if (r.matchmaking) {
        await db().prepare("DELETE FROM matchmaking_matches WHERE user=? AND room=?").bind(id, code).run();
      }
      return reply({ ok: true, matchmakingEnded: !!r.matchmaking });
    }
    return reply({ room: view(r, id), serverNow: Date.now() });
  } catch (e) {
    return reply(
      { error: e instanceof Error ? e.message : "요청을 처리하지 못했습니다." },
      400,
    );
  }
}
