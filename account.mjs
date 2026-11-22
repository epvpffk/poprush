import {env} from './database.mjs';
export function accountDb() { if (!env.DB)
    throw new Error('계정 저장소를 준비 중입니다. 잠시 후 다시 시도해 주세요.'); return env.DB; }
export async function sha256(value) { let bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join(''); }
export async function hashPassword(password, salt) { let encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']); let bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256); return Array.from(new Uint8Array(bits), v => v.toString(16).padStart(2, '0')).join(''); }
export function sessionToken(req) { let entry = (req.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('colorpop_session_v2=')); let token = entry?.slice('colorpop_session_v2='.length) || ''; return /^[a-f0-9]{64}$/.test(token) ? token : null; }
export async function currentAccount(req) { let token = sessionToken(req); if (!token)
    return null; return accountDb().prepare('SELECT a.id,a.username FROM sessions s JOIN accounts a ON a.id=s.user WHERE s.token_hash=? AND s.expires>?').bind(await sha256(token), Date.now()).first(); }
export async function getIdentity(req) { let account = await currentAccount(req); if (account)
    return account.id; let legacy = req.headers.get('oai-authenticated-user-id'); if (legacy) {
    let linked = await accountDb().prepare('SELECT id FROM accounts WHERE id=?').bind(legacy).first();
    if (!linked)
        return legacy;
} return (await currentGuest(req))?.id || null; }
export function sessionCookie(req, token, maxAge = 604800) { return `colorpop_session_v2=${token}; Path=/; HttpOnly; Max-Age=${maxAge}${new URL(req.url).protocol === 'https:' ? '; SameSite=None; Secure; Partitioned' : '; SameSite=Lax'}`; }
export async function createSession(req, user) { let token = Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, '0')).join(''); await accountDb().prepare('INSERT INTO sessions(token_hash,user,expires) VALUES(?,?,?)').bind(await sha256(token), user, Date.now() + 604800000).run(); return sessionCookie(req, token); }
export function sameOrigin(req) { let origin = req.headers.get('origin'); return !origin || origin === new URL(req.url).origin; }
export async function currentGuest(req) { let token = (req.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith('colorpop_guest='))?.slice('colorpop_guest='.length); if (!token || !/^[a-f0-9]{64}$/.test(token))
    return null; return accountDb().prepare("SELECT p.id,p.nickname FROM sessions s JOIN profiles p ON p.id=s.user WHERE s.token_hash=? AND s.expires>? AND p.id LIKE 'guest-%'").bind(await sha256(token), Date.now()).first(); }
export async function ensureGuest(req) { let old = await currentGuest(req); if (old)
    return { profile: { nickname: old.nickname } }; let id = 'guest-' + crypto.randomUUID(), nickname = '게스트-' + crypto.randomUUID().slice(0, 4), token = Array.from(crypto.getRandomValues(new Uint8Array(32)), v => v.toString(16).padStart(2, '0')).join(''); await accountDb().batch([accountDb().prepare('INSERT INTO profiles(id,nickname,created) VALUES(?,?,?)').bind(id, nickname, Date.now()), accountDb().prepare('INSERT INTO sessions(token_hash,user,expires) VALUES(?,?,?)').bind(await sha256(token), id, Date.now() + 604800000)]); return { profile: { nickname }, cookie: sessionCookie(req, token).replace('colorpop_session_v2=', 'colorpop_guest=') }; }
