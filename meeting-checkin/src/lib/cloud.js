/* 云端 API 层：复用站点后端 /checkin 接口 */
export const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.endsWith('.vercel.app'))
  ? '' : 'https://utils.api.zhenzhidaole.com';

export async function api(path, opts = {}) {
  // credentials:'include' 让 utils.api 域的 uno_webapp_session 会话 cookie 随请求带上，
  // 管理接口据此识别已登录用户（同站跨子域，SameSite=Lax 允许）。
  const res = await fetch(API_BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' }, credentials: 'include' }, opts));
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.message) || ('请求失败 (' + res.status + ')'));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function adminHeaders(mid) {
  const p = sessionStorage.getItem('checkin_admin_' + mid) || '';
  return p ? { 'x-admin-pass': p } : {};
}

export function isUnlocked(mid) {
  return !!sessionStorage.getItem('checkin_admin_' + mid);
}

export function signUrlOf(mid) {
  return location.href.split('#')[0] + '#/s/' + mid;
}

/* 我的会议：登录后从云端拉取（自己创建 + 被共享的），跨设备同步 */
export function myMeetings() {
  return api('/checkin/mine');
}

/* 邮箱共享：仅会议创建者可管理，对方用该邮箱账号登录后获得协管权限 */
export function getShares(mid) {
  return api('/checkin/share/' + mid);
}

export function addShare(mid, email) {
  return api('/checkin/share/' + mid, { method: 'POST', body: JSON.stringify({ email }) });
}

export function removeShare(mid, email) {
  return api('/checkin/share/' + mid + '/' + encodeURIComponent(email), { method: 'DELETE' });
}

/* 删除会议（仅创建者；级联删除签到与共享） */
export function deleteMeeting(mid) {
  return api('/checkin/meeting/' + mid, { method: 'DELETE' });
}
