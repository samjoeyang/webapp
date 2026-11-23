/**
 * 统一登录会话（BFF 模式，参考微信网页授权 / django-allauth）。
 *
 * 会话由 utils_api 的 /unoauth/webapp/login 在 utils.api.zhenzhidaole.com 域签发，
 * 使用 Web 门户专属 client（UNOAuth 管理端显示“朕知道了 Web 门户”），存 HttpOnly
 * cookie（uno_webapp_session），不与 utils_api 默认会话共享。浏览器 JS 读不到；
 * 前端只能跨域调用 /unoauth/webapp/me 探测登录态。业务请求带 credentials:'include'
 * 时，同站（eTLD+1 均为 zhenzhidaole.com）cookie 会随请求带上，utils_api 即可识别用户。
 *
 * 稳定性设计（修复「一会登录一会未登录」）：
 *   - 三态缓存：undefined=探测中 / null=未登录 / object=已登录。
 *   - in-flight 去重：多组件同帧调用共享同一次探测，避免各自 setState 打架。
 *   - 订阅广播 useMe()：所有组件同步同一份状态。
 *   - 网络失败兜底为未登录（不卡在"检测中"），刷新页面会重新探测。
 *   - 登录/退出回跳附 ?uno=1：强制重新探测，消除回跳后的旧缓存。
 */

import { useEffect, useState } from 'react';

const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname)
  || location.hostname.endsWith('.vercel.app');

export const AUTH_BASE = LOCAL ? '' : 'https://utils.api.zhenzhidaole.com';

let cache;                 // undefined=未探测; null=未登录; object=已登录
let inflight = null;       // 进行中的探测 Promise（去重）
const listeners = new Set();

const setCache = (v) => {
  cache = v;
  listeners.forEach(fn => { try { fn(v); } catch (_) { /* ignore */ } });
};

const avatarOf = (d) => {
  for (const k of ['picture', 'avatar_url', 'avatar', 'picture_url', 'headimgurl', 'img_url', 'photo']) {
    const url = d?.[k];
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }
  return '';
};

async function probe() {
  // 本地 dev 没有 utils_api 认证后端，直接视为未登录，避免卡在"检测中"
  if (LOCAL) return null;
  // /me 只读本域会话，默认不含头像；头像在 UNOAuth 的 picture claim 中。
  try {
    const res = await fetch(AUTH_BASE + '/unoauth/webapp/me', { credentials: 'include' });
    if (!res.ok) return null;            // 401 = 明确未登录
    const d = await res.json();
    if (!d || !d.login) return null;

    if (!avatarOf(d)) {
      try {
        const infoRes = await fetch(AUTH_BASE + '/unoauth/webapp/userinfo', { credentials: 'include' });
        if (infoRes.ok) {
          const info = await infoRes.json();
          return { ...d, picture: avatarOf(info) || null };
        }
      } catch (_) { /* 头像拉取失败不影响登录态 */ }
    }
    return d;
  } catch (_) {
    return null;                         // 网络/CORS 失败：兜底未登录（刷新会重探，不卡在"检测中"）
  }
}

/**
 * 探测登录态。Promise<user|null>：object=已登录, null=未登录。
 * force=true 强制重新探测；并发调用自动去重。
 */
export function getMe(force = false) {
  if (!force && cache !== undefined) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = probe().then(m => { setCache(m); return m; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** React hook：订阅共享登录态。undefined=探测中 / null=未登录 / object=已登录 */
export function useMe() {
  const [me, setMe] = useState(cache);
  useEffect(() => {
    listeners.add(setMe);
    const fresh = new URLSearchParams(location.search).get('uno') === '1';
    if (fresh || cache === undefined) getMe(true);
    else setMe(cache);
    return () => listeners.delete(setMe);
  }, []);
  return me;
}

export function peekMe() { return cache; }
export function clearMe() { setCache(undefined); }

/** 给回跳地址附加 ?uno=1，使目标页强制重新探测登录态 */
function withFresh(url) {
  const u = new URL(url || location.href, location.href);
  u.searchParams.set('uno', '1');
  return u.href;
}

/** 登录入口：跳 utils_api 的 webapp 专属链路发起授权，完成后回跳 backTo（默认当前页） */
export function loginUrl(backTo) {
  return AUTH_BASE + '/unoauth/webapp/login?next=' + encodeURIComponent(withFresh(backTo));
}

export function goLogin(backTo) {
  location.href = loginUrl(backTo);
}

/** 退出：清 webapp 专属会话后回跳 backTo */
export function logoutUrl(backTo) {
  return AUTH_BASE + '/unoauth/webapp/logout?redirect=' + encodeURIComponent(withFresh(backTo));
}
