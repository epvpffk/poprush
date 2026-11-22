export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function boardHash(board) { let hash = 2166136261; for (let value of board) {
    hash = Math.imul(hash ^ ((value ?? -1) + 2), 16777619);
} return (hash >>> 0).toString(16); }
export function connected(b, i) { if (!Number.isInteger(i) || i < 0 || i >= 100 || b[i] == null)
    return []; let q = [i], seen = new Set(q); for (let j = 0; j < q.length; j++) {
    let p = q[j], r = Math.floor(p / 10), c = p % 10;
    for (let n of [r ? p - 10 : -1, r < 9 ? p + 10 : -1, c ? p - 1 : -1, c < 9 ? p + 1 : -1])
        if (n >= 0 && !seen.has(n) && b[n] === b[i]) {
            seen.add(n);
            q.push(n);
        }
} return q; }
export function groups(b) { let seen = new Set(), out = []; for (let i = 0; i < 100; i++)
    if (b[i] != null && !seen.has(i)) {
        let g = connected(b, i);
        g.forEach(x => seen.add(x));
        if (g.length >= 2)
            out.push(g);
    } return out; }
export function settle(b) { let out = Array(100).fill(null), dest = 0; for (let c = 0; c < 10; c++) {
    let col = [];
    for (let r = 0; r < 10; r++)
        if (b[r * 10 + c] != null)
            col.push(b[r * 10 + c]);
    if (col.length) {
        col.forEach((v, k) => out[(10 - col.length + k) * 10 + dest] = v);
        dest++;
    }
} return out; }
// Independent color draws: no pairing, even-count, or full-clear constraints.
export function makeBoard(seed, colorCount = 4) { let random = rng(seed); for (let attempt = 0; attempt < 100; attempt++) {
    let b = Array.from({ length: 100 }, () => Math.floor(random() * colorCount));
    if (groups(b).length)
        return b;
} throw new Error('새 판을 생성하지 못했습니다. 다시 시작해 주세요.'); }
export function refillBoard(board, seed, colorCount = 4) { let random = rng(seed), out = board.map(c => c == null ? Math.floor(random() * colorCount) : c); if (!groups(out).length) {
    let hole = board.findIndex(c => c == null);
    if (hole >= 0) {
        let row = Math.floor(hole / 10), col = hole % 10;
        let neighbor = [col > 0 ? hole - 1 : -1, col < 9 ? hole + 1 : -1, row > 0 ? hole - 10 : -1, row < 9 ? hole + 10 : -1].find(i => i >= 0);
        if (neighbor !== undefined)
            out[hole] = out[neighbor];
    }
} return out; }
export function refillPlayer(p, seed, colorCount = 4) { p.board = refillBoard(p.board, seed, colorCount); p.remaining = 100; p.done = false; }
export function player(id, name, now, ai = false) { return { id, name, ai, board: [], score: 0, remaining: 100, done: false, forfeit: false, clearAt: null, lastMove: 0, seen: now, reasons: [] }; }
export function comboBonusPercent(combo) { return combo >= 200 ? 250 : combo >= 175 ? 200 : combo >= 150 ? 150 : combo >= 120 ? 100 : combo >= 90 ? 75 : combo >= 60 ? 50 : combo >= 40 ? 35 : combo >= 20 ? 20 : combo >= 10 ? 10 : 0; }
export function popPoints(count, previousCombo, lastPopAt, time) { let combo = previousCombo > 0 && time >= lastPopAt && time - lastPopAt <= 2000 ? previousCombo + 1 : 1, base = count * count * 10, bonus = Math.floor(base * comboBonusPercent(combo) / 100); return { combo, base, bonus, total: base + bonus }; }
export function apply(p, i, time) { let g = connected(p.board, i); if (g.length < 2)
    throw new Error('같은 색 블록 2개 이상을 눌러 주세요.'); g.forEach(x => p.board[x] = null); p.board = settle(p.board); let points = popPoints(g.length, p.combo || 0, p.lastPopAt || 0, time); p.combo = points.combo; p.lastPopAt = time; p.bonusScore = (p.bonusScore || 0) + points.bonus; p.score += points.total; p.remaining -= g.length; p.lastMove = time; p.done = groups(p.board).length === 0; if (!p.remaining && p.clearAt == null)
    p.clearAt = time; return g.length; }
// The same move produces the same next board on client and server.
// Only the server accepts scores; sequence numbers make retries idempotent.
export function playerDeadline(r, p) { return r.endAt - (p?.penaltyMs || 0); }
export function isRefilling(r, time, p) { return !!r.refillMode && time < playerDeadline(r, p) - 30000; }
export function performMove(p, index, time, refill, colorCount = 4) { let seed = (p.nextSeed ?? (p.score ^ 0xa5a5a5a5)) >>> 0, previousClear = p.clearAt; let removed = apply(p, index, time); if (refill) {
    p.clearAt = previousClear;
    refillPlayer(p, seed, colorCount);
} p.nextSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; p.moveSeq = (p.moveSeq || 0) + 1; return removed; }
export function performInput(p, index, time, r) { if (!Number.isInteger(index) || index < 0 || index >= 100 || p.board[index] == null)
    throw new Error('블록을 눌러 주세요.'); if (connected(p.board, index).length < 2) {
    p.combo = 0;
    p.lastPopAt = 0;
    p.mistakes = (p.mistakes || 0) + 1;
    p.moveSeq = (p.moveSeq || 0) + 1;
    if (p.mistakes > 3)
        p.penaltyMs = (p.penaltyMs || 0) + (r.penaltySeconds || 0) * 1000;
    if (time >= playerDeadline(r, p)) {
        p.done = true;
        p.timeExpired = true;
        p.lastMove = time;
    }
    return 0;
} return performMove(p, index, time, isRefilling(r, time, p), r.colors || 4); }
export function begin(r, now, seed) { r.aiRankingEnabled = true; r.practice = r.players.filter(p => !p.ai).length === 1 || r.players.some(p => p.ai); if (r.players.length === 1)
    r.players.push({ ...player('AI', '컬러봇 · 중급', now, true), aiLevel: 1 }); r.players.forEach((p, i) => { p.board = makeBoard((seed + Math.imul(i + 1, 2654435761)) >>> 0, r.colors || 4); p.combo = 0; p.lastPopAt = 0; p.bonusScore = 0; p.lastMove = now + 3000; p.seen = now; p.connectionTracked = false; p.moveSeq = 0; p.mistakes = 0; p.penaltyMs = 0; p.timeExpired = false; p.nextSeed = (seed ^ Math.imul(i + 1, 2654435761)) >>> 0; }); r.status = 'playing'; r.startAt = now + 3000; r.endAt = r.startAt + (r.durationSeconds || 180) * 1000; }
export function elapsedMs(r, p) { return Math.max(0, Math.min(r.endAt - r.startAt, (p.done || p.forfeit ? p.lastMove : r.finishedAt || r.endAt) - r.startAt)); }
export function decide(r, now) { r.finishedAt = now; let active = r.players.filter(p => !p.forfeit); let clears = active.filter(p => p.clearAt != null); let fastest = clears.length ? Math.min(...clears.map(p => p.clearAt)) : null; let hi = Math.max(...active.map(p => p.score)), loScore = Math.min(...active.map(p => p.score)); let low = Math.min(...active.map(p => p.remaining)), hiLeft = Math.max(...active.map(p => p.remaining)); for (let p of r.players) {
    p.reasons = [];
    p.outcome = 'loss';
    if (!p.forfeit) {
        if (fastest != null && p.clearAt === fastest)
            p.reasons.push('최속 전체 제거');
        if (p.score === hi && hi > loScore)
            p.reasons.push('최고 점수');
        if (p.remaining === low && low < hiLeft)
            p.reasons.push('최소 잔여 블록');
    }
} let order = new Map(r.players.map((p, i) => [p.id, i])); let sorted = [...r.players].sort((a, b) => Number(a.forfeit) - Number(b.forfeit) || b.reasons.length - a.reasons.length || b.score - a.score || a.remaining - b.remaining || (a.clearAt ?? Infinity) - (b.clearAt ?? Infinity) || elapsedMs(r, a) - elapsedMs(r, b) || order.get(a.id) - order.get(b.id)); sorted.forEach((p, i) => p.rank = i + 1); let winner = sorted.find(p => !p.forfeit); if (winner) {
    winner.outcome = 'win';
    if (active.length === 1)
        winner.reasons.push('상대 기권');
    else
        winner.reasons.push('종합 순위 1위');
} r.status = 'finished'; }
export const AI_LEVELS = ['초급', '중급', '고급', '매니아', '신'];
export function chooseAiMove(p, gs, level, refill, colors) { if (level === 0)
    return gs[(p.moveSeq || 0) % gs.length][0]; if (level === 1)
    return gs[Math.min(1, gs.length - 1)][0]; if (level === 2)
    return gs[0][0]; let best = gs[0][0], value = -Infinity; for (let g of gs.slice(0, level === 4 ? 6 : 3)) {
    let copy = { ...p, board: [...p.board] };
    performMove(copy, g[0], p.lastMove + 1, refill, colors);
    let next = groups(copy.board).sort((a, b) => b.length - a.length), n = next[0]?.length || 0;
    let score = g.length * g.length + (level === 4 ? 1.0 : 0.5) * n * n + (!refill ? (100 - copy.remaining) * 2 : 0);
    if (!copy.remaining)
        score += 100000;
    if (score > value) {
        value = score;
        best = g[0];
    }
} return best; }
export function tick(r, now) {
    if (r.status === 'waiting') { // Abandoned non-host seats expire; host can leave explicitly.
        r.players = r.players.filter(p => p.ai || (p.connectionTracked ? now - p.seen <= 20000 : p.id === r.host || now - p.seen < 90000));
        if (!r.players.some(p => p.id === r.host && !p.ai))
            r.host = r.players.find(p => !p.ai)?.id || '';
        if (!r.players.some(p => !p.ai)) {
            r.status = 'finished';
            r.practice = true;
            r.finishedAt = now;
        }
        return;
    }
    if (r.status !== 'playing')
        return;
    for (let p of r.players)
        if (!p.ai && !p.forfeit && p.connectionTracked && now - p.seen > 20000) {
            p.forfeit = true;
            p.done = true;
            p.outcome = 'loss';
            p.lastMove = Math.min(r.endAt, p.seen + 20000);
        }
    if (r.players.filter(p => !p.ai).every(p => p.forfeit) || r.players.filter(p => !p.forfeit).length <= 1) {
        decide(r, now);
        return;
    }
    if (now < r.startAt)
        return;
    for (let p of r.players.filter(p => p.ai && !p.done && !p.forfeit)) {
        let level = p.aiLevel ?? 2, interval = [1400, 850, 450, 220, 100][level], until = Math.min(now, playerDeadline(r, p));
        let count = 0;
        while (p.lastMove + interval <= until && !p.done && count++ < 4000) {
            let gs = groups(p.board).sort((a, b) => b.length - a.length);
            if (!gs.length) {
                p.done = true;
                break;
            }
            let moveAt = p.lastMove + interval, index = chooseAiMove(p, gs, level, isRefilling(r, moveAt, p), r.colors || 4);
            performMove(p, index, moveAt, isRefilling(r, moveAt, p), r.colors || 4);
        }
    }
    for (let p of r.players)
        if (!p.done && !p.forfeit && now >= playerDeadline(r, p)) {
            p.done = true;
            p.timeExpired = true;
            p.lastMove = Math.max(r.startAt, playerDeadline(r, p));
        }
    if (r.players.filter(p => !p.ai).every(p => p.forfeit) || now >= r.endAt || r.players.some(p => !p.forfeit && p.remaining === 0) || r.players.every(p => p.done || p.forfeit) || r.players.filter(p => !p.forfeit).length <= 1)
        decide(r, Math.min(now, r.endAt));
}
export function returnToLobby(r, id, now) {
    if (r.status === 'waiting')
        return;
    if (r.status !== 'finished')
        throw new Error('경기가 끝난 후 대기실로 돌아갈 수 있습니다.');
    const self = r.players.find(p => p.id === id);
    if (!self)
        throw new Error('참가자만 사용할 수 있습니다.');
    self.lobbyReady = true;
    self.seen = now;
}
export function settleLobby(r, now) {
    if (r.status !== 'finished' || !r.players.some(p => !p.ai && p.lobbyReady))
        return;
    if (r.players.some(p => !p.ai && !p.lobbyReady && !p.forfeit && now - p.seen < 30000))
        return;
    r.players = r.players.filter(p => p.ai || p.lobbyReady).map(p => ({ ...player(p.id, p.name, now, p.ai), seat: p.seat, aiLevel: p.aiLevel }));
    if (!r.players.some(p => p.id === r.host && !p.ai))
        r.host = r.players.find(p => !p.ai)?.id || '';
    r.status = 'waiting';
    r.startAt = 0;
    r.endAt = 0;
    r.finishedAt = 0;
    r.practice = false;
}
