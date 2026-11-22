import RankPagination from "./rank-pagination";
import { sendRoomLeave, retryPendingRoomLeaves, syncDialog, watchGameFocus } from "./room-lifecycle";
import { attachAudio, releaseAudio, playAudio } from "./audio-mixer";
import {
  acceptsBlockPointer,
  acceptsKeyboardClick,
  blockIndexAtPoint,
} from "./block-input";
import PostBoard from "./post-board";
import AdminTest from "./admin-test";
("use client");
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import MusicPlayer from "./music-player";
import ComboFeedback, { popCombo } from "./combo-feedback";
import {
  connected,
  groups,
  popPoints,
  misclickState,
  misclickNotice,
  rankingTimeMs,
  settle,
  refillBoard,
  performInput,
  isRefilling,
  playerDeadline,
  boardHash,
  makeBoard,
  elapsedMs,
  type Board,
  type Player,
  type Room,
} from "../lib/game";
import { levelColor, progressFromXp } from "../lib/level";
const colors = [
    "#ef7087",
    "#edc15c",
    "#5dbdab",
    "#8583ef",
    "#58aee2",
    "#ee965c",
  ],
  symbols = ["●", "◆", "▲", "✦", "■", "⬟"];
type PublicRoom = Omit<Room, "players"> & { players: Player[] };
async function api(body?: any, code?: string) {
  let res = await fetch(
    "/api/arena" + (code ? "?room=" + encodeURIComponent(code) : ""),
    body
      ? {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        }
      : { cache: "no-store", credentials: "include" },
  );
  let data: any = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(data.error || "연결을 확인해 주세요."), {
      status: res.status,
    });
  return data;
}
function newRunId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
}
export default function Arena() {
  let [rankingPage, setRankingPage] = useState(1),
    [aiRankingPage, setAiRankingPage] = useState(1),
    [adminAllowed, setAdminAllowed] = useState(false),
    [tab, setTab] = useState("battle"),
    [account, setAccount] = useState<{ username: string } | null>(null),
    [authOpen, setAuthOpen] = useState(false),
    [authMode, setAuthMode] = useState<"login" | "register">("login"),
    [authUsername, setAuthUsername] = useState(""),
    [authPassword, setAuthPassword] = useState(""),
    [authNickname, setAuthNickname] = useState(""),
    [authError, setAuthError] = useState(""),
    [authBusy, setAuthBusy] = useState(false),
    [history, setHistory] = useState<{ battles: any[]; solo: any[] }>({
      battles: [],
      solo: [],
    }),
    [room, setRoom] = useState<PublicRoom | null>(null),
    [nickname, setNickname] = useState(""),
    [savedName, setSavedName] = useState(""),
    [code, setCode] = useState(""),
    [joinPassword, setJoinPassword] = useState(""),
    [createOpen, setCreateOpen] = useState(false),
    [roomTitle, setRoomTitle] = useState("POP RUSH 한 판"),
    [roomColors, setRoomColors] = useState(4),
    [capacity, setCapacity] = useState(8),
    [duration, setDuration] = useState(180),
    [refillMode, setRefillMode] = useState(true),
    [usePassword, setUsePassword] = useState(false),
    [roomPassword, setRoomPassword] = useState(""),
    [aiLevel, setAiLevel] = useState(2),
    [aiRankings, setAiRankings] = useState<any[][]>([]),
    [aiStats, setAiStats] = useState<any[]>([]),
    [ranking, setRanking] = useState<any[]>([]),
    [stats, setStats] = useState<any>({}),
    [progress, setProgress] = useState(progressFromXp(0)),
    [matching, setMatching] = useState<any>(null),
    [matchingColors, setMatchingColors] = useState(4),
    [rankMovement, setRankMovement] = useState<{
      before: number;
      after: number;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [login, setLogin] = useState(false),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [highlight, setHighlight] = useState<number[]>([]),
    [solo, setSolo] = useState<Board>(makeBoard(123456)),
    [soloScore, setSoloScore] = useState(0),
    [soloCombo, setSoloCombo] = useState(0),
    [soloLastPop, setSoloLastPop] = useState(0),
    [soloBonus, setSoloBonus] = useState(0),
    [soloDuration, setSoloDuration] = useState(180),
    [soloDurationDraft, setSoloDurationDraft] = useState(180),
    [soloBest, setSoloBest] = useState(0),
    [sound, setSound] = useState(false),
    [resultOpen, setResultOpen] = useState(false),
    [soloStarted, setSoloStarted] = useState(0),
    [soloEnded, setSoloEnded] = useState(0),
    [undo, setUndo] = useState<
      {
        board: Board;
        score: number;
        combo?: number;
        lastPopAt?: number;
        bonus?: number;
      }[]
    >([]);
  let abandonedRoom = useRef("");
  let menuRef = useRef<HTMLElement | null>(null);
  let authEpoch = useRef(0),
    refreshSeq = useRef(0),
    authDialog = useRef<HTMLDialogElement | null>(null),
    closingResult = useRef(false),
    soloRun = useRef(""),
    savedSoloRuns = useRef(new Set<string>());
  let createDialog = useRef<HTMLDialogElement | null>(null);
  let resultDialog = useRef<HTMLDialogElement | null>(null),
    lastResult = useRef("");
  let rankBeforeMatch = useRef<number | null>(null),
    rankMatchKey = useRef("");
  let lastBlockPointer = useRef<{ index: number; time: number } | null>(null);
  let popAudio = useRef<HTMLAudioElement[]>([]),
    popCursor = useRef(0);
  let request = useRef(false),
    lastVersion = useRef(-1),
    roomRef = useRef<PublicRoom | null>(null);
  roomRef.current = room;
  let pendingMoves = useRef<
      {
        code: string;
        index: number;
        seq: number;
        time: number;
        boardHash: string;
      }[]
    >([]),
    sendingMoves = useRef(false),
    soloRef = useRef({
      board: solo,
      score: soloScore,
      combo: soloCombo,
      lastPopAt: soloLastPop,
      bonus: soloBonus,
      undo,
    });
  soloRef.current = {
    board: solo,
    score: soloScore,
    combo: soloCombo,
    lastPopAt: soloLastPop,
    bonus: soloBonus,
    undo,
  };
  function dropRoom(code: string, message: string) {
    if (roomRef.current?.code !== code) return false;
    abandonedRoom.current = code;
    pendingMoves.current = [];
    roomRef.current = null;
    lastVersion.current = -1;
    try {
      localStorage.removeItem("colorpop-room");
    } catch {}
    setRoom(null);
    setResultOpen(false);
    setHighlight([]);
    setTab("battle");
    setError("");
    setNotice(message);
    return true;
  }
  function roomError(error: unknown, code: string) {
    const e = error as Error & { status?: number };
    if (
      e.status === 401 ||
      /이 방의 참가자가 아닙니다|참가자만 사용할 수|방을 찾을 수 없습니다/.test(
        e.message || "",
      )
    )
      return dropRoom(code, "참가 중인 방이 종료되었거나 방에서 나왔습니다.");
    return false;
  }
  function adopt(d: any) {
    if (d.serverNow) setOffset(d.serverNow - Date.now());
    if (!d.room) return;
    let incoming = d.room as PublicRoom;
    if (abandonedRoom.current === incoming.code) return;
    if (incoming.matchmaking && incoming.status === "waiting") {
      roomRef.current = incoming;
      dropRoom(incoming.code, "이전 실시간 대전을 정리했습니다. 새 상대를 찾아보세요.");
      sendRoomLeave(incoming.code);
      void refresh();
      return;
    }
    if (document.hidden) {
      abandonedRoom.current = incoming.code;
      sendRoomLeave(incoming.code);
      try {
        localStorage.removeItem("colorpop-room");
      } catch {}
      return;
    }
    let old = roomRef.current;
    if (
      old &&
      old.code === incoming.code &&
      incoming.version < lastVersion.current
    )
      return;
    if (old?.code !== incoming.code) pendingMoves.current = [];
    lastVersion.current = incoming.version;
    let mine = incoming.players.find((p) => p.id === "me");
    pendingMoves.current = pendingMoves.current.filter(
      (m) => m.code === incoming.code && m.seq >= (mine?.moveSeq || 0),
    );
    let display = incoming;
    if (incoming.status === "playing" && mine && pendingMoves.current.length) {
      let predicted = {
        ...mine,
        board: [...mine.board],
        reasons: [...mine.reasons],
      };
      try {
        for (let m of pendingMoves.current) {
          if (
            m.seq !== (predicted.moveSeq || 0) ||
            m.boardHash !== boardHash(predicted.board)
          )
            throw new Error("sequence");
          performInput(predicted, m.index, m.time, incoming);
        }
        display = {
          ...incoming,
          players: incoming.players.map((p) => (p.id === "me" ? predicted : p)),
        };
      } catch {
        pendingMoves.current = [];
        setError("게임판이 갱신되었습니다. 계속 플레이해 주세요.");
      }
    } else if (incoming.status !== "playing") pendingMoves.current = [];
    roomRef.current = display;
    setRoom(display);
    try {
      localStorage.setItem("colorpop-room", incoming.code);
    } catch {}
  }
  async function flushMoves() {
    if (sendingMoves.current) return;
    sendingMoves.current = true;
    try {
      while (pendingMoves.current.length) {
        let move = pendingMoves.current[0];
        if (roomRef.current?.code !== move.code) {
          pendingMoves.current = [];
          break;
        }
        let delivered = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            let data = await api({
              action: "move",
              code: move.code,
              index: move.index,
              seq: move.seq,
              boardHash: move.boardHash,
            });
            if (roomRef.current?.code === move.code) adopt(data);
            delivered = true;
            break;
          } catch (e) {
            let err = e as Error & { status?: number };
            if (roomRef.current?.code !== move.code) break;
            if (roomError(e, move.code)) break;
            if (err.status || attempt === 2) {
              pendingMoves.current = [];
              setError(err.message);
              try {
                let latest = await api(undefined, move.code);
                if (roomRef.current?.code === move.code) adopt(latest);
              } catch {}
              break;
            }
            await new Promise((resolve) =>
              setTimeout(resolve, 150 * (attempt + 1)),
            );
          }
        }
        if (!delivered) break;
      }
    } finally {
      sendingMoves.current = false;
    }
  }
  function queueMove(index: number) {
    let current = roomRef.current,
      mine = current?.players.find((p) => p.id === "me"),
      time = Date.now() + offset;
    if (
      !current ||
      current.status !== "playing" ||
      !mine ||
      mine.done ||
      mine.forfeit ||
      time < current.startAt ||
      time >= playerDeadline(current, mine)
    )
      return;
    let predicted = {
      ...mine,
      board: [...mine.board],
      reasons: [...mine.reasons],
    };
    let seq = mine.moveSeq || 0;
    let removed = 0;
    try {
      removed = performInput(predicted, index, time, current);
    } catch {
      return;
    }
    if (!removed) setNotice(misclickNotice());
    pendingMoves.current.push({
      code: current.code,
      index,
      seq,
      time,
      boardHash: boardHash(mine.board),
    });
    let display = {
      ...current,
      players: current.players.map((p) => (p.id === "me" ? predicted : p)),
    };
    roomRef.current = display;
    setRoom(display);
    setError("");
    if (removed) {
      popCombo(index, predicted.combo || 1, mine.combo || 0);
      tone();
      let bonus = (predicted.bonusScore || 0) - (mine.bonusScore || 0);
      setNotice(
        `${predicted.combo || 1}콤보${bonus ? ` · 추가 보너스 +${bonus}점` : ""}`,
      );
    }
    void flushMoves();
  }
  async function refresh() {
    let epoch = authEpoch.current,
      seq = ++refreshSeq.current;
    try {
      let d = await api();
      if (epoch !== authEpoch.current || seq !== refreshSeq.current) return;
      if (!d.account && !d.profile) {
        let response = await fetch("/api/account", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "guest" }),
        });
        if (!response.ok)
          throw new Error(
            "게스트 연결을 준비하지 못했습니다. 다시 시도해 주세요.",
          );
        d = await api();
      }
      if (epoch !== authEpoch.current || seq !== refreshSeq.current) return;
      setAccount(d.account || null);
      setHistory(d.history || { battles: [], solo: [] });
      setRanking(d.ranking || []);
      setAiRankings(d.aiRanking || []);
      setAiStats(d.aiStats || []);
      setStats(d.stats || {});
      setProgress(d.progress || progressFromXp(0));
      if (
        roomRef.current?.status === "finished" &&
        rankBeforeMatch.current &&
        d.stats?.rank &&
        rankBeforeMatch.current !== d.stats.rank
      )
        setRankMovement({
          before: rankBeforeMatch.current,
          after: d.stats.rank,
        });
      if (d.profile) {
        setSavedName(d.profile.nickname);
        setNickname(d.profile.nickname);
      } else {
        setSavedName("");
        setNickname("");
      }
      if (d.account) setSoloBest(d.soloBest || 0);
      else
        try {
          setSoloBest(Number(localStorage.getItem("colorpop-best")) || 0);
        } catch {}
      setLogin(false);
    } catch (e) {
      if (epoch !== authEpoch.current || seq !== refreshSeq.current) return;
      let m = (e as Error).message;
      setLogin(m.includes("로그인"));
      setError(m);
    }
  }
  async function authenticate(e: FormEvent) {
    e.preventDefault();
    if (authBusy) return;
    authEpoch.current++;
    setAuthBusy(true);
    setAuthError("");
    try {
      let response = await fetch("/api/account", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: authMode,
          username: authUsername,
          password: authPassword,
          ...(authMode === "register" && authNickname.trim()
            ? { nickname: authNickname.trim() }
            : {}),
        }),
      });
      let data: any = await response.json();
      if (!response.ok) throw new Error(data.error || "로그인하지 못했습니다.");
      setAccount(data.account);
      setSavedName(data.profile?.nickname || "");
      setNickname(data.profile?.nickname || "");
      setAuthPassword("");
      setAuthOpen(false);
      setLogin(false);
      setError("");
      resetSolo(false);
      setTab("battle");
      await refresh();
      setNotice(
        authMode === "register"
          ? "가입이 완료되었습니다. 바로 대전방을 만들 수 있어요."
          : "로그인했습니다. 아이디의 기록을 불러왔어요.",
      );
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  }
  async function logout() {
    authEpoch.current++;
    if (
      roomRef.current?.status === "playing" &&
      !confirm("진행 중인 경기는 기권 처리됩니다. 로그아웃할까요?")
    )
      return;
    try {
      if (roomRef.current)
        await api({ action: "leave", code: roomRef.current.code });
      let response = await fetch("/api/account", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다.");
      pendingMoves.current = [];
      roomRef.current = null;
      setRoom(null);
      lastVersion.current = -1;
      try {
        localStorage.removeItem("colorpop-room");
      } catch {}
      setAccount(null);
      setSavedName("");
      setNickname("");
      setStats({});
      setProgress(progressFromXp(0));
      setMatching(null);
      setHistory({ battles: [], solo: [] });
      resetSolo(false);
      setTab("battle");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function closeResults() {
    if (closingResult.current) return;
    closingResult.current = true;
    try {
      if (tab === "battle" && roomRef.current?.status === "finished") {
        const current = roomRef.current;
        setError("");
        if (current.matchmaking) {
          await api({ action: "leave", code: current.code });
          dropRoom(current.code, "실시간 대전이 종료되었습니다. 새 상대를 찾아보세요.");
          setMatching(null);
        } else {
          const d = await api({ action: "return_to_lobby", code: current.code });
          pendingMoves.current = [];
          adopt(d);
          setNotice("대전방 대기실로 돌아왔습니다.");
        }
        await refresh();
      }
      if (tab === "solo") resetSolo(false);
      setResultOpen(false);
      setTab("battle");
    } catch (e) {
      setError((e as Error).message);
      setResultOpen(true);
    } finally {
      closingResult.current = false;
    }
  }
  useEffect(() => {
    refresh();
    const resumeLeaves = () => { if (!document.hidden) retryPendingRoomLeaves(); };
    resumeLeaves();
    window.addEventListener("pageshow", resumeLeaves);
    window.addEventListener("focus", resumeLeaves);
    document.addEventListener("visibilitychange", resumeLeaves);
    try {
      setSoloBest(Number(localStorage.getItem("colorpop-best")) || 0);
    } catch {}
    let cached = "";
    try {
      cached = localStorage.getItem("colorpop-room") || "";
    } catch {}
    if (cached)
      api(undefined, cached)
        .then(adopt)
        .catch(() => {
          try {
            localStorage.removeItem("colorpop-room");
          } catch {}
        });
    let timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", resumeLeaves);
      window.removeEventListener("focus", resumeLeaves);
      document.removeEventListener("visibilitychange", resumeLeaves);
    };
  }, []);
  useEffect(() => {
    if (!room) return;
    let gone = false;
    let timer = setInterval(
      async () => {
        if (request.current || document.hidden) return;
        request.current = true;
        try {
          let d = await api(undefined, room.code);
          if (!gone && roomRef.current?.code === room.code) {
            adopt(d);
            setError("");
          }
        } catch (e) {
          if (
            !gone &&
            roomRef.current?.code === room.code &&
            !roomError(e, room.code)
          )
            setError((e as Error).message);
        } finally {
          request.current = false;
        }
      },
      room.status === "playing" ? 1000 : 2500,
    );
    return () => {
      gone = true;
      clearInterval(timer);
    };
  }, [room?.code, room?.status]);
  useEffect(() => {
    if (!room) return;
    const code = room.code;
    const beat = () => {
      if (!document.hidden && roomRef.current?.code === code)
        void api({ action: "heartbeat", code }).catch(() => {});
    };
    const exit = () => {
      if (dropRoom(code, "다른 창으로 이동하여 대전방에서 나왔습니다."))
        sendRoomLeave(code);
    };
    beat();
    const timer = setInterval(beat, 5000);
    const stopWatching = watchGameFocus(exit);
    return () => {
      clearInterval(timer);
      stopWatching();
    };
  }, [room?.code]);
  useEffect(() => {
    if (room?.status === "finished") refresh();
  }, [room?.status]);
  useEffect(() => {
    if (!room || room.status !== "playing") return;
    const key = room.matchId || room.code + ":" + room.startAt;
    if (rankMatchKey.current === key) return;
    rankMatchKey.current = key;
    rankBeforeMatch.current = stats.rank || 101;
    setRankMovement(null);
  }, [room?.code, room?.matchId, room?.status, room?.startAt]);
  useEffect(() => {
    if (matching?.status !== "waiting" || tab !== "battle" || room) return;
    let stopped = false;
    const poll = async () => {
      try {
        const d = await api({ action: "matchmaking", colors: matchingColors });
        if (stopped) return;
        if (d.matchmaking?.status === "matched" && d.matchmaking.room) {
          abandonedRoom.current = "";
          setMatching(null);
          adopt({ room: d.matchmaking.room, serverNow: d.serverNow });
          setNotice("비슷한 레벨의 상대를 찾았습니다. 곧 경기가 시작됩니다!");
        } else setMatching(d.matchmaking || null);
      } catch (e) {
        if (!stopped) {
          setMatching(null);
          setError((e as Error).message);
        }
      }
    };
    const timer = setInterval(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [matching?.status, matchingColors, tab, room?.code]);
  useEffect(() => {
    if (tab === "battle" || matching?.status !== "waiting") return;
    setMatching(null);
    void api({ action: "matchmaking_cancel" }).catch(() => {});
  }, [tab, matching?.status]);
  async function toggleMatchmaking() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (matching?.status === "waiting") {
        await api({ action: "matchmaking_cancel" });
        setMatching(null);
        setNotice("실시간 매칭을 취소했습니다.");
      } else {
        const d = await api({ action: "matchmaking", colors: matchingColors });
        if (d.matchmaking?.status === "matched" && d.matchmaking.room) {
          abandonedRoom.current = "";
          setMatching(null);
          adopt({ room: d.matchmaking.room, serverNow: d.serverNow });
        } else {
          setMatching(d.matchmaking);
          setNotice("비슷한 레벨의 상대를 찾고 있습니다.");
        }
      }
    } catch (e) {
      setMatching(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(action: string, extra: any = {}) {
    if (busy) return;
    if (action === "join" || action === "create") abandonedRoom.current = "";
    setBusy(true);
    request.current = true;
    setError("");
    try {
      let submittedNickname = nickname.trim();
      let d = await api({
        action,
        code: room?.code,
        ...extra,
        ...(action === "profile" ? { nickname: submittedNickname } : {}),
      });
      if (action === "profile") {
        let confirmedNickname = d.profile?.nickname || submittedNickname;
        setSavedName(confirmedNickname);
        setNickname(confirmedNickname);
        setNotice("닉네임을 저장했어요.");
        await refresh();
      } else if (action === "leave") {
        setResultOpen(false);
        pendingMoves.current = [];
        roomRef.current = null;
        setRoom(null);
        lastVersion.current = -1;
        try {
          localStorage.removeItem("colorpop-room");
        } catch {}
        await refresh();
      } else {
        adopt(d);
        if (action === "create") {
          setCreateOpen(false);
          setRoomPassword("");
        }
      }
    } catch (e) {
      const target =
        action === "join"
          ? String(extra.code || "")
          : roomRef.current?.code || "";
      if (!roomError(e, target)) setError((e as Error).message);
    } finally {
      request.current = false;
      setBusy(false);
    }
  }
  let self = room?.players.find((p) => p.id === "me"),
    clock = now + offset,
    left = room
      ? Math.max(0, Math.ceil((playerDeadline(room, self) - clock) / 1000))
      : 180,
    countdown =
      room?.status === "playing" && clock < room.startAt
        ? Math.ceil((room.startAt - clock) / 1000)
        : 0;
  let playing =
    room?.status === "playing" &&
    !countdown &&
    !self?.done &&
    !self?.forfeit &&
    left > 0;
  let board = tab === "solo" ? solo : self?.board || [];
  let score = tab === "solo" ? soloScore : self?.score || 0;
  let remain = board.filter((x) => x !== null).length;
  useEffect(() => {
    const pool = Array.from({ length: 6 }, () => {
      const a = new Audio("/sounds/block-pop.mp3");
      a.preload = "auto";
      attachAudio(a);
      a.load();
      return a;
    });
    popAudio.current = pool;
    return () => {
      for (const a of pool) {
        a.pause();
        releaseAudio(a);
        a.removeAttribute("src");
        a.load();
      }
      popAudio.current = [];
    };
  }, []);
  function tone() {
    try {
      const pool = popAudio.current;
      if (!pool.length) return;
      const a =
        pool.find((item) => item.paused || item.ended) ||
        pool[popCursor.current++ % pool.length];
      a.currentTime = 0;
      void playAudio(a).catch(() => {});
    } catch {}
  }
  function click(i: number) {
    setHighlight([]);
    if (tab !== "solo") {
      queueMove(i);
      return;
    }
    if (!soloStarted) return;
    let snapshot = soloRef.current,
      time = Date.now(),
      deadline = soloStarted + soloDuration * 1000;
    if (
      soloEnded ||
      (soloStarted &&
        (time >= deadline ||
          (time >= deadline - 30000 && !groups(snapshot.board).length)))
    ) {
      if (!soloEnded) setSoloEnded(time);
      setResultOpen(true);
      return;
    }
    let g = connected(snapshot.board, i);
    if (g.length < 2) {
      if (snapshot.board[i] == null) return;
      let miss = misclickState();
      soloRef.current = { ...snapshot, ...miss };
      setSoloCombo(miss.combo);
      setSoloLastPop(miss.lastPopAt);
      setNotice(misclickNotice());
      return;
    }
    let history = [
      ...snapshot.undo,
      {
        board: [...snapshot.board],
        score: snapshot.score,
        combo: snapshot.combo,
        lastPopAt: snapshot.lastPopAt,
        bonus: snapshot.bonus,
      },
    ];
    setUndo(history);
    let b = [...snapshot.board];
    g.forEach((x) => (b[x] = null));
    let settled = settle(b);
    let nextBoard =
      time < soloStarted + (soloDuration - 30) * 1000
        ? refillBoard(settled, time, 4)
        : settled;
    let points = popPoints(
        g.length,
        snapshot.combo,
        snapshot.lastPopAt,
        time,
      ),
      nextScore = snapshot.score + points.total;
    popCombo(i, points.combo, snapshot.combo);
    setSoloCombo(points.combo);
    setSoloLastPop(time);
    setSoloBonus(snapshot.bonus + points.bonus);
    soloRef.current = {
      ...snapshot,
      board: nextBoard,
      score: nextScore,
      combo: points.combo,
      lastPopAt: time,
      bonus: snapshot.bonus + points.bonus,
      undo: history,
    };
    setSolo(nextBoard);
    setSoloScore(nextScore);
    if (nextScore > soloBest) {
      setSoloBest(nextScore);
      if (!account)
        try {
          localStorage.setItem("colorpop-best", String(nextScore));
        } catch {}
    }
    tone();
    setNotice(
      `${g.length}개 팝! +${points.total}점${points.bonus ? ` · ${points.combo}콤보 보너스 +${points.bonus}점` : ""}`,
    );
  }
  useEffect(() => {
    if (tab !== "solo" || !soloStarted || soloEnded) return;
    return watchGameFocus(() => {
      setSoloEnded(Date.now());
      setResultOpen(true);
      setNotice("다른 창으로 이동하여 자유 플레이가 종료되었습니다.");
    });
  }, [tab, soloStarted, soloEnded]);
  function hint() {
    let g = groups(board).sort((a, b) => b.length - a.length)[0];
    setHighlight(g || []);
    setNotice(
      g
        ? `${g.length}개 묶음을 표시했어요.`
        : "더 이상 터뜨릴 수 있는 블록이 없어요.",
    );
  }
  let finished = room?.status === "finished";
  useEffect(() => {
    if (tab !== "solo" || !soloStarted) return;
    if (
      !soloEnded &&
      (now >= soloStarted + soloDuration * 1000 ||
        (now >= soloStarted + (soloDuration - 30) * 1000 &&
          !groups(solo).length))
    ) {
      setSoloEnded(Date.now());
      setResultOpen(true);
      setNotice("게임이 종료되었습니다.");
    }
  }, [tab, now, solo, soloStarted, soloEnded, soloDuration]);
  useEffect(() => {
    if (tab !== "battle" || !room || !self || room.status === "waiting") return;
    if (!finished) return;
    let key = (room.matchId || room.code + ":" + room.finishedAt) + ":final";
    if (lastResult.current !== key) {
      lastResult.current = key;
      setResultOpen(true);
    }
  }, [tab, room?.code, room?.matchId, room?.finishedAt, finished, self?.done]);
  useEffect(() => {
    let dialog = authDialog.current;
    if (!dialog) return;
    syncDialog(dialog, authOpen);
  }, [authOpen]);
  useEffect(() => {
    let dialog = createDialog.current;
    if (!dialog) return;
    syncDialog(dialog, createOpen);
  }, [createOpen]);
  useEffect(() => {
    let dialog = resultDialog.current;
    if (!dialog) return;
    syncDialog(dialog, resultOpen);
  }, [resultOpen]);
  function resetSolo(startNow: boolean) {
    soloRun.current = newRunId();
    setSoloCombo(0);
    setSoloLastPop(0);
    setSoloBonus(0);
    setSolo(makeBoard(Date.now()));
    setSoloScore(0);
    setUndo([]);
    setSoloStarted(startNow ? Date.now() : 0);
    setSoloEnded(0);
    setResultOpen(false);
    setHighlight([]);
    setNotice(startNow ? "새 게임을 시작했어요." : "");
  }
  function newSolo() {
    resetSolo(false);
  }
  function startSolo() {
    setSoloDuration(soloDurationDraft);
    resetSolo(true);
  }
  useEffect(() => {
    if (
      !soloEnded ||
      !account ||
      !soloRun.current ||
      savedSoloRuns.current.has(soloRun.current)
    )
      return;
    let run = soloRun.current;
    savedSoloRuns.current.add(run);
    api({
      action: "solo_result",
      run,
      score: soloScore,
      remaining: solo.filter((c) => c !== null).length,
      elapsed: Math.min(
        soloDuration,
        Math.max(0, Math.floor((soloEnded - soloStarted) / 1000)),
      ),
    })
      .then(() => refresh())
      .catch(() => {
        savedSoloRuns.current.delete(run);
        setError(
          "자유 플레이 기록을 저장하지 못했습니다. 연결을 확인해 주세요.",
        );
      });
  }, [soloEnded, account?.username]);
  let resultSeconds =
    tab === "solo"
      ? Math.max(
          0,
          Math.floor(((soloEnded || Date.now()) - soloStarted) / 1000),
        )
      : room
        ? Math.max(
            0,
            Math.min(
              room.durationSeconds || 180,
              Math.floor(
                ((self?.done ? self.lastMove : room.finishedAt || clock) -
                  room.startAt) /
                  1000,
              ),
            ),
          )
        : 0;
  let soloLeft = Math.max(
    0,
    Math.min(
      soloDuration,
      Math.ceil(
        (soloDuration * 1000 - (now - soloStarted)) / 1000,
      ),
    ),
  );

  let resultTime = `${Math.floor(resultSeconds / 60)}분 ${String(resultSeconds % 60).padStart(2, "0")}초`;

  let gameVisible = !!(
    (tab === "solo" && soloStarted > 0) ||
    (tab === "battle" && room && room.status !== "waiting")
  );
  useEffect(() => {
    if (gameVisible && window.matchMedia("(max-width:700px)").matches)
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [gameVisible]);
  useEffect(() => {
    const reveal = () => {
      const nav = menuRef.current;
      if (
        !nav ||
        !window.matchMedia("(max-width:1024px), (pointer:coarse)").matches
      )
        return;
      const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) return;
      nav.scrollTo({
        left: Math.max(
          0,
          Math.min(
            nav.scrollWidth - nav.clientWidth,
            selected.offsetLeft - (nav.clientWidth - selected.offsetWidth) / 2,
          ),
        ),
        behavior: window.matchMedia("(prefers-reduced-motion:reduce)").matches
          ? "instant"
          : "smooth",
      });
    };
    const frame = requestAnimationFrame(reveal);
    window.addEventListener("resize", reveal);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", reveal);
    };
  }, [tab, adminAllowed]);

  return (
    <main
      className={
        (tab === "solo" && soloStarted > 0) ||
        (tab === "battle" && room && room.status !== "waiting")
          ? "game-active"
          : ""
      }
    >
      <header>
        <a className="brand" href="/">
          ▦ POP <span>RUSH</span>
          <em>ARENA</em>
        </a>
        <div className="headright">
          <span className="online">● ONLINE PUZZLE</span>
          <span>
            {savedName || "게스트"}
            <LevelBadge level={progress.level} compact />
            {account && (
              <small className="account-id">@{account.username}</small>
            )}
          </span>
          {account ? (
            <button className="ghost" onClick={logout}>
              로그아웃
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => {
                setAuthError("");
                setAuthOpen(true);
              }}
            >
              로그인 / 회원가입
            </button>
          )}
        </div>
      </header>
      <ComboFeedback
        scope={tab + ":" + (room?.code || "") + ":" + soloStarted}
        active={
          tab === "solo"
            ? soloStarted > 0 && !soloEnded && soloLeft > 0
            : tab === "battle" && !!playing
        }
      />
      <nav ref={menuRef} className="game-nav" aria-label="게임 메뉴">
        {[
          ["notice", "공지사항"],
          ["battle", "⚡ 대전 아레나"],
          ["ranking", "♛ 랭킹 TOP 100"],
          ["ai-ranking", "🤖 AI 랭킹 순위"],
          ["solo", "▦ 자유 플레이"],
          ["records", "◷ 내 기록"],
          ...(adminAllowed && account?.username === "admin"
            ? [["admin-test", "⚙ 운영자 테스트"]]
            : []),
          ["feedback", "버그&건의사항"],
        ].map(([v, t]) => (
          <button
            type="button"
            key={v}
            aria-current={tab === v ? "page" : undefined}
            onClick={async () => {
              if (v !== "battle" && roomRef.current?.status === "playing") {
                await action("leave");
                if (roomRef.current?.status === "playing") return;
              }
              setTab(v);
              if (v === "ranking") setRankingPage(1);
              if (v === "ai-ranking") setAiRankingPage(1);
              setResultOpen(false);
              setError("");
              setNotice("");
              setHighlight([]);
              if (v === "ranking" || v === "ai-ranking") refresh();
            }}
            className={tab === v ? "active" : ""}
          >
            {t}
          </button>
        ))}
      </nav>
      <MusicPlayer
        active={true}
        playing={
          tab === "solo"
            ? soloStarted > 0 && !soloEnded && soloLeft > 0
            : tab === "battle" && !!playing
        }
        restartKey={
          tab === "solo" && soloStarted > 0
            ? `solo:${soloStarted}`
            : tab === "battle" &&
                room?.status === "playing" &&
                clock >= room.startAt
              ? `battle:${room.code}:${room.startAt}`
              : ""
        }
        urgent={
          tab === "solo"
            ? soloStarted > 0 && !soloEnded && soloLeft > 0 && soloLeft <= 30
            : tab === "battle" && !!playing && left <= 30
        }
      />
      {(error || login) && (
        <div className="alert" role="alert">
          {error || "기록을 저장하려면 로그인해 주세요."}
          {login && (
            <>
              {" "}
              <button
                className="ghost"
                onClick={() => {
                  setAuthError("");
                  setAuthOpen(true);
                }}
              >
                게임 아이디로 로그인 →
              </button>
            </>
          )}
        </div>
      )}
      <AdminTest
        username={account?.username}
        visible={tab === "admin-test"}
        onAllowed={setAdminAllowed}
        onProgress={setProgress}
      />
      {tab === "notice" || tab === "feedback" ? (
        <PostBoard
          key={tab}
          kind={tab === "notice" ? "notice" : "feedback"}
          username={account?.username}
          admin={adminAllowed && account?.username === "admin"}
          onLogin={() => {
            setAuthError("");
            setAuthOpen(true);
          }}
        />
      ) : tab === "admin-test" ? null : tab === "ai-ranking" ? (
        <section className="ranking">
          <div className="eyebrow">AI CHALLENGE RANKING</div>
          <h1>AI 랭킹 순위</h1>
          <p>
            난이도별 AI 상대 승패를 확인하세요. 일반 대전 랭킹과 별도로
            기록됩니다.
          </p>
          <div className="actions ai-difficulty">
            {["초급", "중급", "고급", "매니아", "신"].map((name, level) => (
              <button
                key={level}
                className={aiLevel === level ? "primary" : "ghost"}
                onClick={() => {
                  setAiLevel(level);
                  setAiRankingPage(1);
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="statgrid">
            <Stat
              label="나의 승리"
              value={aiStats.find((p) => p.level === aiLevel)?.wins || 0}
            />
            <Stat
              label="나의 패배"
              value={aiStats.find((p) => p.level === aiLevel)?.losses || 0}
            />
            <Stat
              label="AI 랭킹 점수"
              value={aiStats.find((p) => p.level === aiLevel)?.points || 0}
            />
          </div>
          <div className="tablebox">
            <div className="tabletitle">
              <h2>
                {["초급", "중급", "고급", "매니아", "신"][aiLevel]} TOP 100{" "}
                <span>
                  {(aiRankingPage - 1) * 10 + 1} — {aiRankingPage * 10}
                </span>
              </h2>
              <button className="ghost" onClick={refresh}>
                새로고침
              </button>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>플레이어</th>
                    <th>점수</th>
                    <th>승 / 패</th>
                    <th>승률</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 10 }, (_, rowIndex) => {
                    let i = (aiRankingPage - 1) * 10 + rowIndex;
                    let p = aiRankings[aiLevel]?.[i];
                    return (
                      <tr key={i} className={p?.me ? "myrow" : ""}>
                        <td>{i + 1}</td>
                        <td>
                          {p ? (
                            <>
                              {p.nickname} {p.me && <b className="tag">나</b>}
                            </>
                          ) : (
                            "도전자를 기다리고 있어요"
                          )}
                        </td>
                        <td>{p?.points ?? "—"}</td>
                        <td>{p ? `${p.wins} / ${p.losses}` : "—"}</td>
                        <td>
                          {p ? Math.round((p.wins / p.games) * 100) + "%" : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <RankPagination
            page={aiRankingPage}
            onChange={setAiRankingPage}
            label="AI 랭킹 페이지"
          />
          <p className="fine">
            한 경기당 한 번만 기록합니다. 종합 1위는 1승, 나머지는 1패입니다.
            여러 난이도가 섞이면 가장 높은 AI 난이도에 한 번만 집계합니다. 승리
            +30점 · 패배 −10점 · 최저 0점. 동점은 승수 → 최고 점수 → 등록 순서로
            정렬합니다.
          </p>
        </section>
      ) : tab === "records" ? (
        <section className="ranking">
          <div className="eyebrow">MY PLAY HISTORY</div>
          <h1>나의 한 판, 나의 기록.</h1>
          {account ? (
            <>
              <p>
                <b>{account.username}</b> 아이디로 저장된 기록입니다. 닉네임을
                바꿔도 기록은 유지됩니다.
              </p>
              <div className="statgrid">
                <Stat label="승리" value={stats.wins || 0} />
                <Stat label="패배" value={stats.losses || 0} />
                <Stat label="랭킹 점수" value={stats.points || 0} />
                <Stat
                  label="자유 플레이 최고"
                  value={soloBest.toLocaleString()}
                />
              </div>
              <h2>대전 기록 · 최근 20경기</h2>
              <HistoryTable rows={history.battles} />
              <h2 className="history-heading">자유 플레이 · 최근 20경기</h2>
              <HistoryTable rows={history.solo} solo />
            </>
          ) : (
            <div className="card">
              <p>
                아이디로 로그인하면 기기를 바꿔도 같은 기록을 확인할 수 있어요.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setAuthError("");
                  setAuthOpen(true);
                }}
              >
                로그인 / 회원가입
              </button>
            </div>
          )}
        </section>
      ) : tab === "ranking" ? (
        <section className="ranking">
          <div className="eyebrow">THE HALL OF POP</div>
          <h1>작은 블록, 커다란 승부.</h1>
          <p>사람과 겨룬 경기만 집계합니다.</p>
          <div className="statgrid">
            <Stat label="내 랭킹 점수" value={stats.points || 0} />
            <Stat label="승리" value={stats.wins || 0} />
            <Stat label="패배" value={stats.losses || 0} />
          </div>
          <div className="tablebox">
            <div className="tabletitle">
              <h2>
                전체 랭킹{" "}
                <span>
                  {(rankingPage - 1) * 10 + 1} — {rankingPage * 10}
                </span>
              </h2>
              <button className="ghost" onClick={refresh}>
                ↻ 새로고침
              </button>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>플레이어</th>
                    <th>레벨</th>
                    <th>랭킹 점수</th>
                    <th>승 / 패</th>
                    <th>승률</th>
                    <th>최고 경기 점수</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 10 }, (_, rowIndex) => {
                    let i = (rankingPage - 1) * 10 + rowIndex;
                    let p = ranking[i];
                    return (
                      <tr key={i} className={p?.me ? "myrow" : ""}>
                        <td>
                          <span className={i < 3 ? "medal m" + i : ""}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </td>
                        <td>
                          {p ? (
                            <>
                              {p.nickname} {p.me && <b className="tag">나</b>}
                            </>
                          ) : (
                            <span className="muted">
                              도전자를 기다리고 있어요
                            </span>
                          )}
                        </td>
                        <td>
                          {p ? <LevelBadge level={p.progress?.level || 1} compact /> : "—"}
                        </td>
                        <td>{p ? p.points.toLocaleString() : "—"}</td>
                        <td>{p ? `${p.wins} / ${p.losses}` : "—"}</td>
                        <td>
                          {p ? Math.round((p.wins / p.games) * 100) + "%" : "—"}
                        </td>
                        <td>{p ? p.best.toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <RankPagination
            page={rankingPage}
            onChange={setRankingPage}
            label="일반 랭킹 페이지"
          />
          <p className="fine">
            승리 +30점 · 패배 −10점 · 총점 최저 0점. 동점은 승수 → 최고 경기
            점수 → 먼저 등록한 순서로 정렬합니다. AI 포함 연습전은 제외됩니다.
          </p>
        </section>
      ) : (
        <div className="layout">
          <section className="game-panel">
            <div className="eyebrow arena-intro">
              {tab === "solo"
                ? "MULTIPLAYER / UP TO 8 PLAYERS"
                : room
                  ? "RANDOM BOARD. YOUR STRATEGY."
                  : "MULTIPLAYER / UP TO 8 PLAYERS"}
            </div>
            <h1 className="arena-intro">
              {tab === "solo" ? (
                <>
                  함께 터뜨리는
                  <br />
                  짜릿한 한 판.
                </>
              ) : room ? (
                room.status === "waiting" ? (
                  <>
                    친구가 모이면,
                    <br />
                    승부가 시작됩니다.
                  </>
                ) : (
                  <>
                    각자의 판 위에서,
                    <br />
                    다른 한 수.
                  </>
                )
              ) : (
                <>
                  함께 터뜨리는
                  <br />
                  짜릿한 한 판.
                </>
              )}
            </h1>
            <p className="arena-intro">
              {tab === "solo"
                ? "최대 8명이 각자의 랜덤 블록판에서 겨루는 POP RUSH 대전. 혼자 시작해도 컬러봇이 함께해요."
                : room
                  ? "각자 랜덤 블록판 · 같은 시간 · 단 한 명의 승자"
                  : "최대 8명이 각자의 랜덤 블록판에서 겨루는 POP RUSH 대전. 혼자 시작해도 컬러봇이 함께해요."}
            </p>
            {tab === "battle" && !room && (
              <>
                <div className="statgrid">
                  <div className="stat level-stat">
                    <small>나의 레벨</small>
                    <LevelBadge level={progress.level} />
                    <div className="level-progress" aria-label={`경험치 ${progress.percent}%`}>
                      <i style={{ width: `${progress.percent}%` }} />
                    </div>
                    <em>
                      {progress.atMax
                        ? "최고 레벨"
                        : `${progress.currentXp.toLocaleString()} / ${progress.nextXp.toLocaleString()} XP`}
                    </em>
                  </div>
                  <Stat label="나의 승리" value={stats.wins || 0} />
                  <Stat label="나의 패배" value={stats.losses || 0} />
                  <Stat label="랭킹 점수" value={stats.points || 0} />
                </div>
                <div className={"matchmaking-card card" + (matching?.status === "waiting" ? " searching" : "")}>
                  <div>
                    <span className="eyebrow">REAL-TIME LEVEL MATCH</span>
                    <h2>비슷한 레벨과 바로 대전</h2>
                    <p>
                      1대1 자동 매칭 · {matchingColors}가지 색 · 3분 · 내 레벨 기준으로 검색
                    </p>
                    <div className="match-color-options" role="group" aria-label="실시간 대전 블록 색상 수">
                      {[4,5,6].map(count=><button type="button" key={count} aria-pressed={matchingColors===count} className={matchingColors===count?'primary':'ghost'} disabled={busy||matching?.status==='waiting'} onClick={()=>setMatchingColors(count)}>{count}가지 색</button>)}
                    </div>
                    {matching?.status === "waiting" && (
                      <div className="matching-status" role="status">
                        <span className="matching-pulse" /> 상대 찾는 중 · {matching.waitSeconds || 0}초
                        <small>
                          {matching.colors || matchingColors}가지 색 · {matching.level}레벨 기준 ±{matching.range}레벨
                        </small>
                      </div>
                    )}
                  </div>
                  <button
                    className={matching?.status === "waiting" ? "ghost" : "primary"}
                    disabled={busy || !savedName}
                    onClick={() => void toggleMatchmaking()}
                  >
                    {matching?.status === "waiting" ? "매칭 취소" : "실시간 대전 찾기"}
                  </button>
                </div>
                <div className="lobbyhero">
                  <div className="decorblocks" aria-hidden="true">
                    {[0, 2, 1, 3, 1, 0, 2, 3, 2, 1, 3, 0, 3, 2, 0, 1].map(
                      (c, i) => (
                        <span key={i} style={{ background: colors[c] }}>
                          {symbols[c]}
                        </span>
                      ),
                    )}
                  </div>
                  <div>
                    <span className="eyebrow">READY TO POP?</span>
                    <h2>
                      한 판의 시작은
                      <br />
                      나만의 방에서.
                    </h2>
                    <p>
                      방을 만들고 친구에게 코드를 알려 주세요.
                      <br />
                      혼자라면 바로 AI 연습전을 시작할 수 있어요.
                    </p>
                    <button
                      className="primary"
                      disabled={busy || !savedName}
                      onClick={() => {
                        setError("");
                        setCreateOpen(true);
                      }}
                    >
                      ＋ 대전방 만들기
                    </button>
                  </div>
                </div>
                <div className="join card">
                  <h2>친구의 방에 입장하기</h2>
                  <div className="inputrow">
                    <input
                      aria-label="방 코드"
                      placeholder="8자리 방 코드"
                      maxLength={8}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                    />
                    <button
                      className="primary"
                      disabled={busy || !savedName || code.length !== 8}
                      onClick={() =>
                        action("join", { code, password: joinPassword })
                      }
                    >
                      입장 →
                    </button>
                  </div>
                  <input
                    className="join-password"
                    type="password"
                    aria-label="입장 비밀번호"
                    placeholder="비밀번호가 있는 방이면 입력"
                    value={joinPassword}
                    maxLength={32}
                    onChange={(e) => setJoinPassword(e.target.value)}
                  />
                </div>
              </>
            )}
            {tab === "battle" && room?.status === "waiting" && (
              <div className="card waiting">
                <h2>
                  {room.title || "POP RUSH 대전방"} {room.locked && "🔒"}
                </h2>
                <p className="room-options">
                  {room.colors || 4}가지 색 · 최대 {room.maxPlayers || 8}명 ·{" "}
                  {Math.floor((room.durationSeconds || 180) / 60)}분{" "}
                  {(room.durationSeconds || 180) % 60}초 ·{" "}
                  {room.refillMode ? "마지막 30초 리필 중단" : "클래식"}
                </p>
                <div className="roomlabel">
                  ROOM CODE{" "}
                  <button
                    className="code"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(room.code)
                        .then(() => setNotice("방 코드를 복사했어요."))
                        .catch(() => setNotice("방 코드: " + room.code));
                    }}
                  >
                    {room.code} ⧉
                  </button>
                </div>
                <div className="seats">
                  {Array.from(
                    { length: Math.max(2, room.maxPlayers || 8) },
                    (_, i) => {
                      let p = room.players.find(
                        (p, index) => (p.seat ?? index) === i,
                      );
                      return (
                        <div
                          key={i}
                          className={p ? "seat filled" : "seat"}
                          onClick={() => {
                            if (!p && !busy && room.host === "me")
                              void action("add_ai", { seat: i, level: 1 });
                          }}
                        >
                          <span>
                            {p ? (p.ai ? "🤖" : p.name.slice(0, 1)) : "＋"}
                          </span>
                          <b>{p ? p.name : "참가 대기"}</b>
                          {p && !p.ai && <LevelBadge level={p.level || 1} compact />}
                          {p?.ai ? (
                            <>
                              <select
                                aria-label={`AI ${i} 난이도`}
                                disabled={busy || room.host !== "me"}
                                value={p.aiLevel ?? 2}
                                onChange={(e) =>
                                  action("set_ai", {
                                    seat: i,
                                    level: Number(e.target.value),
                                  })
                                }
                              >
                                {["초급", "중급", "고급", "매니아", "신"].map(
                                  (name, level) => (
                                    <option key={level} value={level}>
                                      {name}
                                    </option>
                                  ),
                                )}
                              </select>
                              {room.host === "me" && (
                                <button
                                  className="ghost"
                                  disabled={busy}
                                  onClick={() =>
                                    action("remove_ai", { seat: i })
                                  }
                                >
                                  AI 빼기
                                </button>
                              )}
                            </>
                          ) : p ? (
                            <small>{p.id === "me" ? "나" : "참가 완료"}</small>
                          ) : (
                            <button
                              className="ghost"
                              disabled={busy || room.host !== "me"}
                            >
                              AI 추가
                            </button>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
                <p>
                  현재 {room.players.length} /{" "}
                  {Math.max(2, room.maxPlayers || 8)}명 · 빈칸에서 AI를
                  추가하세요. AI전은 난이도별 AI 랭킹에 기록됩니다.
                </p>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      room.awaitingReturn ||
                      room.host !== "me" ||
                      room.players.length < 2
                    }
                    onClick={() => action("start")}
                  >
                    {room.awaitingReturn
                      ? "참가자 결과 확인 중…"
                      : room.host === "me"
                        ? "게임 시작"
                        : "방장이 시작하기를 기다리는 중"}
                  </button>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() => action("leave")}
                  >
                    나가기
                  </button>
                </div>
              </div>
            )}
            {tab === "solo" && !soloStarted && (
              <div className="card create-form">
                <span className="eyebrow">FREE PLAY</span>
                <h2>자유 플레이 시작</h2>
                <p>제한 시간을 선택하고 시작해 주세요.</p>
                <label htmlFor="solo-start-duration">제한 시간</label>
                <select
                  id="solo-start-duration"
                  value={soloDurationDraft}
                  onChange={(e) => setSoloDurationDraft(Number(e.target.value))}
                >
                  {[180, 300].map((n) => (
                    <option key={n} value={n}>
                      {n / 60}분
                    </option>
                  ))}
                </select>
                <p className="fine">
                  총 {soloDurationDraft / 60}분 · 경과{" "}
                  {soloDurationDraft / 60 - 1}분 30초부터 리필 중단 · 마지막
                  30초 정리
                </p>
                <div className="actions">
                  <button className="primary" onClick={startSolo}>
                    게임 시작
                  </button>
                  <button className="ghost" onClick={() => setTab("battle")}>
                    나가기
                  </button>
                </div>
              </div>
            )}
            {((tab === "solo" && soloStarted > 0) ||
              (tab === "battle" && room && room.status !== "waiting")) && (
              <>
                <div className="statgrid">
                  <Stat label="현재 점수" value={score.toLocaleString()} />
                  <Stat label="남은 블록" value={remain} />
                  <Stat
                    label={
                      tab === "solo"
                        ? "남은 시간"
                        : room?.practice
                          ? "AI전 · 별도 기록"
                          : "남은 시간"
                    }
                    value={
                      tab === "solo"
                        ? `${Math.floor(soloLeft / 60)}:${String(soloLeft % 60).padStart(2, "0")}`
                        : countdown
                          ? `${countdown}초 후 시작`
                          : finished
                            ? "종료"
                            : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
                    }
                  />
                </div>
                <div className="boardwrap">
                  <div
                    className="board"
                    aria-label="블록 게임판"
                    onPointerDown={(e) => {
                      if (!acceptsBlockPointer(e)) return;
                      const tiles =
                        e.currentTarget.querySelectorAll<HTMLButtonElement>(
                          ".tile",
                        );
                      if (tiles.length !== 100) return;
                      const i = blockIndexAtPoint(
                        e.clientX,
                        e.clientY,
                        tiles[0].getBoundingClientRect(),
                        tiles[99].getBoundingClientRect(),
                      );
                      const target = tiles[i];
                      if (!target || target.disabled) return;
                      e.preventDefault();
                      e.stopPropagation();
                      lastBlockPointer.current = {
                        index: i,
                        time: performance.now(),
                      };
                      if (e.pointerType === "mouse")
                        target.focus({ preventScroll: true });
                      click(i);
                    }}
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {board.map((c, i) => (
                      <button
                        key={i}
                        data-index={i}
                        className={
                          "tile" +
                          (c == null ? " empty" : "") +
                          (highlight.includes(i) ? " selected" : "")
                        }
                        style={{
                          background: c == null ? "transparent" : colors[c],
                        }}
                        aria-label={`${Math.floor(i / 10) + 1}행 ${(i % 10) + 1}열 ${c == null ? "빈칸" : ["분홍", "노랑", "초록", "보라", "파랑", "주황"][c]}`}
                        draggable={false}
                        disabled={c == null || (tab === "battle" && !playing)}
                        onClick={(e) => {
                          e.preventDefault();
                          if (
                            acceptsKeyboardClick(
                              e.detail,
                              i,
                              lastBlockPointer.current,
                              performance.now(),
                            )
                          )
                            click(i);
                        }}
                        onDoubleClick={(e) => e.preventDefault()}
                        onDragStart={(e) => e.preventDefault()}
                        onContextMenu={(e) => e.preventDefault()}
                        onPointerEnter={(e) => {
                          if (e.pointerType === "mouse")
                            setHighlight(connected(board, i));
                        }}
                        onPointerLeave={(e) => {
                          if (e.pointerType === "mouse") setHighlight([]);
                        }}
                      >
                        {c != null ? symbols[c] : ""}
                      </button>
                    ))}
                  </div>
                  {countdown > 0 && (
                    <div className="overlay">
                      <strong>{countdown}</strong>
                      <span>랜덤한 판, 동시에 시작!</span>
                    </div>
                  )}
                </div>
                {((tab === "solo" && soloEnded > 0) ||
                  (tab === "battle" && finished)) && (
                  <button
                    className="ghost result-reopen"
                    onClick={() => setResultOpen(true)}
                  >
                    결과 다시 보기
                  </button>
                )}
                <div className="boardstatus">
                  {tab === "solo"
                    ? soloEnded
                      ? "플레이 완료!"
                      : `${soloLeft <= 30 ? "마지막 30초 · 리필 중단" : "계속 리필 중"} · 터뜨릴 수 있는 묶음 ${groups(solo).length}개`
                    : self?.forfeit
                      ? "기권했습니다."
                      : finished
                        ? "경기가 종료되었습니다."
                        : self?.done
                          ? self.timeExpired
                            ? "시간 종료! 상대의 결과를 기다립니다."
                            : "플레이 완료! 상대의 결과를 기다립니다."
                          : `${room && isRefilling(room, clock, self) ? "리필 중" : room?.refillMode ? "마지막 30초 · 리필 중단" : "클래식"} · 같은 색 2개 이상을 눌러 주세요.`}
                </div>
                <div className="actions">
                  {tab === "solo" ? (
                    <>
                      <button className="primary" onClick={newSolo}>
                        ↻ 새 게임
                      </button>
                      <button
                        className="ghost"
                        disabled={!undo.length || soloEnded > 0}
                        onClick={() => {
                          let h = undo[undo.length - 1];
                          setSolo(h.board);
                          setSoloScore(h.score);
                          setSoloCombo(h.combo || 0);
                          setSoloLastPop(h.lastPopAt || 0);
                          setSoloBonus(h.bonus || 0);
                          setUndo(undo.slice(0, -1));
                          setResultOpen(false);
                          setNotice("한 수 되돌렸어요.");
                        }}
                      >
                        되돌리기
                      </button>
                      <button className="ghost" onClick={hint}>
                        힌트
                      </button>
                    </>
                  ) : (
                    <button
                      className="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (finished) void closeResults();
                        else void action("leave");
                      }}
                    >
                      {finished ? (room?.matchmaking ? "아레나로 돌아가기" : "대기실로 돌아가기") : "기권하고 나가기"}
                    </button>
                  )}
                </div>
              </>
            )}
            {tab === "battle" && finished && (
              <div className="card results">
                <span className="eyebrow">
                  MATCH RESULT {room?.practice ? " / PRACTICE" : ""}
                </span>
                <h2>
                  {self?.outcome === "win"
                    ? "종합 1위! 승리했어요."
                    : `종합 ${self?.rank || "—"}위 · 다음 판에 도전해요.`}
                </h2>
                <p>
                  {room?.practice
                    ? "AI 연습전입니다. 승패와 랭킹에는 반영되지 않습니다."
                    : "조건별 우세 수를 먼저 비교하고, 동률이면 점수 → 잔여 블록 → 전체 제거 시간으로 단독 승자를 정합니다."}
                </p>
                <MatchTable room={room!} />
                <p className="fine">
                  점수 높은 순 → 남은 블록 적은 순 → 클리어·종료 시간 빠른
                  순으로 정합니다. 모두 같으면 입장 순서입니다.
                </p>
              </div>
            )}
            <p className="notice" role="status" aria-live="polite">
              {notice || "\u00a0"}
            </p>
          </section>
          <aside>
            <div className="card profile">
              <span className="eyebrow">PLAYER PROFILE</span>
              <h2>나의 플레이어 카드</h2>
              <label htmlFor="nickname">랭킹에 표시할 닉네임</label>
              <div className="inputrow">
                <input
                  id="nickname"
                  placeholder="2~16자 닉네임"
                  value={nickname}
                  maxLength={16}
                  onChange={(e) => setNickname(e.target.value)}
                />
                <button
                  className="ghost"
                  disabled={busy || nickname.trim().length < 2}
                  onClick={() => action("profile")}
                >
                  저장
                </button>
              </div>
              <p className="fine">
                {account
                  ? `${account.username} 아이디에 승패와 기록이 저장됩니다.`
                  : "게스트로 대전할 수 있어요. 승패·랭킹 기록은 로그인 계정에 저장됩니다."}
              </p>
              {!account && (
                <button
                  className="ghost profile-login"
                  onClick={() => {
                    setAuthError("");
                    setAuthMode("register");
                    setAuthOpen(true);
                  }}
                >
                  로그인 / 회원가입
                </button>
              )}
            </div>
            {tab === "battle" && room && room.status !== "waiting" && (
              <div className="card">
                <div className="sectiontitle">
                  <h2>라이브 스코어</h2>
                  <span className="live">● LIVE</span>
                </div>
                {room.players.map((p, i) => (
                  <div
                    className={"opponent " + (p.id === "me" ? "mine" : "")}
                    key={p.id}
                  >
                    <div className="ophead">
                      <b>
                        {p.name}{" "}
                        {p.id === "me" && <span className="tag">나</span>}
                        {p.ai && <span className="tag">AI</span>}
                      </b>
                      <small>
                        {p.forfeit
                          ? "기권"
                          : p.done
                            ? "완료"
                            : finished
                              ? "종료"
                              : "플레이 중"}
                      </small>
                    </div>
                    <div className="opstats">
                      <strong>
                        {p.score.toLocaleString()}
                        <small>점</small>
                      </strong>
                      <span>
                        {p.remaining}개 남음
                      </span>
                    </div>
                    <div className="progress">
                      <span
                        style={{
                          width: 100 - p.remaining + "%",
                          background: colors[i % 4],
                        }}
                      />
                    </div>
                    <div
                      className="miniboard"
                      aria-label={`${p.name}의 블록판`}
                    >
                      {p.board.map((c, j) => (
                        <span
                          key={j}
                          style={{
                            background: c == null ? "transparent" : colors[c],
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                <p className="fine">약 1초 간격으로 갱신됩니다.</p>
              </div>
            )}
            <div className="card rules">
              <span className="eyebrow">HOW TO WIN</span>
              <h2>순위 결정 순서</h2>
              <Rule
                n="01"
                title="점수가 높은 순"
                text="경기 종료 시 점수가 높은 참가자가 먼저 순위에 올라요."
              />
              <Rule
                n="02"
                title="남은 블록이 적은 순"
                text="점수가 같으면 남은 블록 수가 적은 참가자가 앞서요."
              />
              <Rule
                n="03"
                title="클리어 시간이 빠른 순"
                text="점수와 남은 블록 수도 같으면 클리어·종료 시간이 빠른 참가자가 앞서요."
              />
              <div className="rulefoot">
                종합 순위 1위만 1승 · 나머지 전원 1패
                <br />
                점수 높은 순 → 남은 블록 적은 순 → 클리어·종료 시간 빠른 순
                <br />
                모두 같으면 입장 순서 · 기권은 패배
                <br />
                리필 모드: 마지막 30초는 보충 없이 정리 · 정리 완료 시 조기 종료
              </div>
            </div>
            <div className="card tip">
              <span className="eyebrow">FAIR PLAY</span>
              <p>
                방에서 정한 3~6가지 색을 무작위 배치한 판을 각자 받아요. 짝이나
                전체 제거를 보장하지 않으며, 블록이 남을 수 있어요. 힌트와
                되돌리기는 자유 플레이에서만 사용할 수 있어요.
              </p>
            </div>
          </aside>
        </div>
      )}
      <dialog
        ref={authDialog}
        className="result-dialog auth-dialog"
        aria-labelledby="auth-heading"
        onCancel={() => setAuthOpen(false)}
        onClose={() => setAuthOpen(false)}
      >
        <form
          className="result-dialog-body create-form"
          onSubmit={authenticate}
        >
          <span className="eyebrow">YOUR ID. YOUR RECORD.</span>
          <h2 id="auth-heading">
            {authMode === "login"
              ? "다시 만나서 반가워요"
              : "나만의 플레이어 만들기"}
          </h2>
          <p>게임 아이디와 비밀번호만 있으면 돼요.</p>
          <div className="auth-tabs">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
                setAuthPassword("");
              }}
            >
              로그인
            </button>
            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
                setAuthPassword("");
              }}
            >
              회원가입
            </button>
          </div>
          <label htmlFor="account-username">아이디</label>
          <input
            id="account-username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            placeholder="영문·숫자·밑줄 3~20자"
            value={authUsername}
            onChange={(e) => setAuthUsername(e.target.value)}
          />
          <label htmlFor="account-password">비밀번호</label>
          <input
            id="account-password"
            type="password"
            autoComplete={
              authMode === "register" ? "new-password" : "current-password"
            }
            required
            minLength={8}
            maxLength={128}
            placeholder="8자 이상"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
          />
          {authMode === "register" && (
            <>
              <label htmlFor="account-nickname">
                닉네임 <small>선택 · 나중에 변경 가능</small>
              </label>
              <input
                id="account-nickname"
                autoComplete="nickname"
                maxLength={16}
                minLength={2}
                placeholder="입력하지 않으면 아이디로 시작해요"
                value={authNickname}
                onChange={(e) => setAuthNickname(e.target.value)}
              />
            </>
          )}
          {authError && (
            <p role="alert" className="create-error">
              {authError}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setAuthOpen(false)}
            >
              취소
            </button>
            <button type="submit" className="primary" disabled={authBusy}>
              {authBusy
                ? "확인 중…"
                : authMode === "login"
                  ? "로그인"
                  : "가입하고 시작하기"}
            </button>
          </div>
          <p className="fine">
            아이디별로 대전 승패와 자유 플레이 기록이 저장됩니다.
          </p>
        </form>
      </dialog>
      <dialog
        ref={createDialog}
        className="result-dialog create-dialog"
        aria-labelledby="create-heading"
        onCancel={() => setCreateOpen(false)}
        onClose={() => setCreateOpen(false)}
      >
        <form
          className="result-dialog-body create-form"
          onSubmit={(e) => {
            e.preventDefault();
            action("create", {
              title: roomTitle,
              colors: roomColors,
              maxPlayers: capacity,
              durationSeconds: duration,
              refillMode,
              password: usePassword ? roomPassword : "",
            });
          }}
        >
          <span className="eyebrow">CREATE YOUR ROOM</span>
          <h2 id="create-heading">나만의 대전방 만들기</h2>
          <p>함께할 인원과 원하는 게임 규칙을 골라 주세요.</p>
          <label htmlFor="room-title">방 제목</label>
          <input
            id="room-title"
            value={roomTitle}
            minLength={2}
            maxLength={32}
            required
            onChange={(e) => setRoomTitle(e.target.value)}
          />
          <div className="settings-grid">
            <div>
              <label htmlFor="room-colors">블록 색상 수</label>
              <select
                id="room-colors"
                value={roomColors}
                onChange={(e) => setRoomColors(Number(e.target.value))}
              >
                {[3, 4, 5, 6].map((n) => (
                  <option value={n} key={n}>
                    {n}가지 색{n === 3 ? " · 쉬움" : n === 6 ? " · 어려움" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="room-capacity">최대 인원</label>
              <select
                id="room-capacity"
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option value={n} key={n}>
                    {n}명{n === 1 ? " · AI용 1칸 추가" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor="room-refill">진행 방식</label>
          <select
            id="room-refill"
            value={refillMode ? "refill" : "classic"}
            onChange={(e) => setRefillMode(e.target.value === "refill")}
          >
            <option value="refill">리필 후 정리 · 마지막 30초 보충 중단</option>
            <option value="classic">클래식 · 남은 블록 없애기</option>
          </select>
          <label htmlFor="room-duration">제한 시간</label>
          <select
            id="room-duration"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {[180, 300].map((n) => (
              <option value={n} key={n}>
                {Math.floor(n / 60)}분{n % 60 ? ` ${n % 60}초` : ""}
              </option>
            ))}
          </select>
          <label className="checkrow">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => setUsePassword(e.target.checked)}
            />
            <span>비밀번호 설정</span>
            <small>{usePassword ? "잠금방" : "비밀번호 없이 입장"}</small>
          </label>
          {usePassword && (
            <input
              type="password"
              aria-label="방 비밀번호"
              autoComplete="new-password"
              placeholder="비밀번호 4~32자"
              value={roomPassword}
              minLength={4}
              maxLength={32}
              required
              onChange={(e) => setRoomPassword(e.target.value)}
            />
          )}
          <p className="fine">
            같은 색 블록 2개 이상을 터뜨리고 2초 안에 이어서 누르면 콤보가 이어집니다. AI도 참가칸을 사용합니다. 1인 설정은 AI용
            추가칸이 제공됩니다. AI전 기록은 난이도별 AI 랭킹에 따로 저장됩니다.
          </p>
          {error && (
            <p className="create-error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => setCreateOpen(false)}
            >
              취소
            </button>
            <button
              type="submit"
              className="primary"
              disabled={
                busy ||
                roomTitle.trim().length < 2 ||
                (usePassword && roomPassword.length < 4)
              }
            >
              {busy ? "만드는 중…" : "방 만들기"}
            </button>
          </div>
        </form>
      </dialog>
      <dialog
        ref={resultDialog}
        className={"result-dialog" + (tab === "battle" ? " match-dialog" : "")}
        aria-labelledby="result-heading"
        onCancel={(e) => {
          e.preventDefault();
          void closeResults();
        }}
        onClose={() => {
          if (resultOpen) void closeResults();
        }}
      >
        <div className="result-dialog-body">
          <span className="eyebrow">
            {tab === "solo" ? "PLAY RESULT" : "FINAL STANDINGS"}
          </span>
          <div className="result-icon" aria-hidden="true">
            {tab === "battle" ? "♛" : remain === 0 ? "✦" : "▦"}
          </div>
          <h2 id="result-heading">
            {tab === "battle" ? "대전 종합 결과" : "게임이 종료되었습니다."}
          </h2>
          <p>
            {tab === "battle"
              ? room?.practice
                ? "AI전 결과는 로그인 계정의 난이도별 AI 랭킹에 기록됩니다."
                : "1위는 승리, 나머지는 패배입니다. 전적은 로그인 계정에 저장됩니다."
              : remain === 0
                ? "모든 블록을 없앴어요!"
                : remain > 0 && soloLeft > 0
                  ? "더 이상 제거할 수 있는 블록이 없습니다."
                  : `${soloDuration / 60}분 제한 시간이 끝났습니다.`}
          </p>
          {tab === "battle" && room ? (
            <>
              <MatchTable room={room} />
              <div className="xp-result">
                <div>
                  <small>블록 점수 경험치</small>
                  <strong>
                    {account ? `+${(self as any)?.xpEarned || 0} XP` : "로그인 후 저장"}
                  </strong>
                </div>
                <span>
                  {account
                    ? "대전 블록 점수 500점당 1XP"
                    : "게스트 경기는 경험치를 저장하지 않습니다."}
                </span>
              </div>
              {rankMovement && (
                <div
                  className={
                    "rank-movement " +
                    (rankMovement.after < rankMovement.before ? "up" : "down")
                  }
                  role="status"
                >
                  <span>
                    {rankMovement.before > 100
                      ? "TOP 100 밖"
                      : `${rankMovement.before}위`}
                  </span>
                  <b>
                    {rankMovement.after < rankMovement.before ? "▲" : "▼"}
                    {Math.abs(rankMovement.before - rankMovement.after)}
                  </b>
                  <strong>{rankMovement.after}위</strong>
                </div>
              )}
              <p className="result-match-note">
                나의 최종 순위: {self?.rank || "—"}위 ·{" "}
                {self?.outcome === "win" ? "승리" : "패배"}
                {room.practice && (
                  <>
                    <br />
                    AI전 · 난이도별 AI 랭킹에 별도 기록
                  </>
                )}
              </p>
              <p className="fine">
                점수 높은 순 → 남은 블록 적은 순 → 클리어·종료 시간 빠른 순으로
                정합니다. 모두 같으면 입장 순서입니다.
              </p>
            </>
          ) : (
            <div className="result-metrics">
              <div>
                <small>점수</small>
                <strong>
                  {score.toLocaleString()}
                  <em>점</em>
                </strong>
              </div>
              <div>
                <small>남은 블록 수</small>
                <strong>
                  {remain}
                  <em>개</em>
                </strong>
              </div>
              <div>
                <small>플레이 시간</small>
                <strong className="result-time">{resultTime}</strong>
              </div>
            </div>
          )}
          <div className="actions">
            {tab === "solo" ? (
              <>
                <button className="primary" onClick={newSolo}>
                  새 게임
                </button>
                <button className="ghost" onClick={() => void closeResults()}>
                  나가기
                </button>
              </>
            ) : (
              <button className="primary" onClick={() => void closeResults()}>
                {room?.matchmaking ? "확인 · 아레나로 돌아가기" : "확인 · 대전방으로 돌아가기"}
              </button>
            )}
          </div>
        </div>
      </dialog>
      <footer>
        POP RUSH · 한 수의 차이가 만드는 즐거움 · 제작자 루시드컴퍼니{" "}
        <small className="release-tag">v59</small>
      </footer>
    </main>
  );
}
function LevelBadge({ level, compact = false }: { level: number; compact?: boolean }) {
  const safe = Math.max(1, Math.min(200, Math.floor(level || 1)));
  return (
    <span
      className={"level-badge" + (compact ? " compact" : "")}
      style={{ "--level-color": levelColor(safe) } as CSSProperties}
      aria-label={`${safe}레벨`}
    >
      <b>{safe}</b>
      <span>레벨</span>
    </span>
  );
}
function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
function Rule({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <div className="rule">
      <span>{n}</span>
      <div>
        <b>{title}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}

function MatchTable({ room }: { room: PublicRoom }) {
  return (
    <div className="match-table-scroll">
      <table className="match-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>참가자</th>
            <th>레벨</th>
            <th>점수</th>
            <th>남은 블록 수</th>
            <th>클리어·종료 시간</th>
            <th>결과</th>
          </tr>
        </thead>
        <tbody>
          {[...room.players]
            .sort((a, b) => (a.rank || 99) - (b.rank || 99))
            .map((p) => {
              let seconds = Math.floor(rankingTimeMs(room, p) / 1000);
              return (
                <tr
                  key={p.id}
                  className={
                    (p.id === "me" ? "myrow " : "") +
                    (p.rank === 1 ? "winnerrow" : "")
                  }
                >
                  <td>
                    <b>
                      {p.rank === 1 ? "♛ " : ""}
                      {p.rank || "—"}위
                    </b>
                  </td>
                  <td>
                    {p.name} {p.id === "me" && <span className="tag">나</span>}
                    {p.ai && <span className="tag">AI</span>}
                  </td>
                  <td>
                    {p.ai ? "—" : <LevelBadge level={p.level || 1} compact />}
                  </td>
                  <td>{p.score.toLocaleString()}</td>
                  <td>{p.remaining}개</td>
                  <td>
                    {Math.floor(seconds / 60)}분{" "}
                    {String(seconds % 60).padStart(2, "0")}초
                  </td>
                  <td className={p.outcome === "win" ? "win" : ""}>
                    {p.outcome === "win" ? "승리" : "패배"}
                    {p.forfeit ? " · 기권" : ""}
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ rows, solo = false }: { rows: any[]; solo?: boolean }) {
  return (
    <div className="match-table-scroll">
      <table className="match-table">
        <thead>
          <tr>
            <th>날짜</th>
            {!solo && <th>결과</th>}
            <th>점수</th>
            <th>남은 블록</th>
            {solo && <th>시간</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.created).toLocaleString("ko-KR")}</td>
                {!solo && (
                  <td className={r.outcome === "win" ? "win" : ""}>
                    {r.outcome === "win" ? "승리" : "패배"}
                  </td>
                )}
                <td>{r.score.toLocaleString()}</td>
                <td>{r.remaining}개</td>
                {solo && (
                  <td>
                    {Math.floor(r.elapsed / 60)}분 {r.elapsed % 60}초
                  </td>
                )}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={solo ? 4 : 4}>
                아직 저장된 기록이 없습니다. 첫 경기를 시작해 보세요.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
