import { accountDb, sha256, hashPassword, currentAccount, sessionToken, sessionCookie, createSession, sameOrigin, ensureGuest } from './account.mjs';
export const dynamic = 'force-dynamic';
function reply(data, status = 200, cookie) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } }); }
export async function GET(req) { try {
    let a = await currentAccount(req);
    return reply({ account: a ? { username: a.username } : null });
}
catch {
    return reply({ error: '계정 정보를 읽지 못했습니다.' }, 503);
} }
export async function POST(req) {
    try {
        if (!sameOrigin(req))
            return reply({ error: '허용되지 않은 요청입니다.' }, 403);
        let data = await req.json(), db = accountDb(), now = Date.now();
        if (data.action === 'guest') {
            let account = await currentAccount(req);
            if (account)
                return reply({ account: { username: account.username } });
            let guest = await ensureGuest(req);
            return reply({ ok: true, profile: guest.profile }, 200, guest.cookie);
        }
        if (data.action === 'logout') {
            let token = sessionToken(req);
            if (token)
                await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
            return reply({ ok: true }, 200, sessionCookie(req, '', 0));
        }
        if (!['register', 'login'].includes(data.action))
            return reply({ error: '잘못된 요청입니다.' }, 400);
        let username = String(data.username || '').trim().toLowerCase(), password = String(data.password || '');
        if (!/^[a-z0-9_]{3,20}$/.test(username))
            return reply({ error: '아이디는 영문·숫자·밑줄 3~20자로 입력해 주세요.' }, 400);
        if (password.length < 8 || password.length > 128)
            return reply({ error: '비밀번호는 8~128자로 입력해 주세요.' }, 400);
        let rateKey = await sha256('login:' + username), rate = await db.prepare('SELECT attempts,updated FROM auth_rates WHERE key=?').bind(rateKey).first();
        if (rate && rate.attempts >= 10 && now - rate.updated < 600000)
            return reply({ error: '로그인 시도가 많습니다. 10분 후 다시 시도해 주세요.' }, 429);
        let account = await db.prepare('SELECT * FROM accounts WHERE username=?').bind(username).first();
        if (data.action === 'register') {
            if (account)
                return reply({ error: '이미 사용 중인 아이디입니다.' }, 409);
            let nickname = String(data.nickname || username.slice(0, 16)).trim();
            if (nickname.length < 2 || nickname.length > 16 || /[<>\x00-\x1f]/.test(nickname))
                return reply({ error: '닉네임은 2~16자로 입력해 주세요.' }, 400);
            let id = crypto.randomUUID(), legacy = req.headers.get('oai-authenticated-user-id');
            if (legacy) {
                let existing = await db.prepare('SELECT id FROM profiles WHERE id=?').bind(legacy).first();
                let linked = await db.prepare('SELECT id FROM accounts WHERE id=?').bind(legacy).first();
                if (existing && !linked)
                    id = legacy;
            }
            let salt = crypto.randomUUID(), hash = await hashPassword(password, salt);
            try {
                await db.batch([db.prepare('INSERT INTO accounts(id,username,password_hash,salt,created) VALUES(?,?,?,?,?)').bind(id, username, hash, salt, now), db.prepare('INSERT INTO profiles(id,nickname,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname').bind(id, nickname, now)]);
            }
            catch (e) {
                if (String(e).includes('UNIQUE'))
                    return reply({ error: '이미 사용 중인 아이디입니다.' }, 409);
                throw e;
            }
            let cookie = await createSession(req, id);
            return reply({ ok: true, account: { username }, profile: { nickname } }, 200, cookie);
        }
        let actual = await hashPassword(password, account?.salt || 'colorpop-login-dummy-salt');
        if (!account || actual !== account.password_hash) {
            await db.prepare('INSERT INTO auth_rates(key,attempts,updated) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rates.updated<? THEN 1 ELSE auth_rates.attempts+1 END,updated=excluded.updated').bind(rateKey, now, now - 600000).run();
            return reply({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, 401);
        }
        await db.prepare('DELETE FROM auth_rates WHERE key=?').bind(rateKey).run();
        let cookie = await createSession(req, account.id);
        await db.prepare('DELETE FROM sessions WHERE expires<?').bind(now).run();
        let p = await db.prepare('SELECT nickname FROM profiles WHERE id=?').bind(account.id).first();
        return reply({ ok: true, account: { username }, profile: p }, 200, cookie);
    }
    catch {
        return reply({ error: '계정 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
}
