import copyToClipboard from 'copy-to-clipboard';
import qrcode from 'qrcode-generator';
import { api, signUrlOf } from './cloud.js';
import { toast } from './toast.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = ts => {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function copy(text) {
  const ok = copyToClipboard(text);
  toast(ok ? '已复制' : '复制失败，请长按链接复制');
}

export function qrSvg(text, size) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}

export function isPhone(p) {
  return /^1[3-9]\d{9}$/.test(p);
}

export function fmtDT(s) {
  if (!s) return '';
  const [d, t] = s.split('T');
  if (!d) return s;
  const p = n => +n;
  const [, mo, da] = d.split('-');
  const parts = t ? t.split(':') : [''];
  return `${p(mo)}月${p(da)}日${t ? ` ${parts[0]}:${parts[1]}` : ''}`;
}

export function isMobile() {
  return /android|iphone|ipad|ipod|harmony/i.test(navigator.userAgent);
}

/* AI 填会技能：远程安装提示语 */
export function skillUrl() {
  return location.href.split('#')[0].replace(/[^/]*$/, '') + 'skill/SKILL.md' + location.search;
}

export function installPrompt() {
  return '请帮我远程安装一个名为「会议信息」的 WorkBuddy 技能（若已安装则覆盖更新）：\n'
    + '1. 获取以下链接的内容：' + skillUrl() + '\n'
    + '2. 将内容原样写入 ~/.workbuddy/skills/meeting-info/SKILL.md（目录不存在请先创建）\n'
    + '3. 写入成功后简要确认，并告诉我如何使用\n\n'
    + '以后需要更新技能时，把本段提示语重新发送一次即可。';
}

export function addToCalendar(mid) {
  api('/checkin/meeting/' + mid).then(m => {
    const dt = new Date(m.tm);
    if (isNaN(dt)) return toast('该会议未填写会议时间');
    const end = new Date(dt.getTime() + 60 * 60 * 1000);
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const e = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    const signUrl = signUrlOf(mid);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorkBuddy//Meeting//CN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:' + mid + '@workbuddy', 'DTSTAMP:' + f(new Date()),
      'DTSTART:' + f(dt), 'DTEND:' + f(end), 'SUMMARY:' + e(m.t), 'LOCATION:' + e(m.pl || ''),
      'DESCRIPTION:' + e((m.i || '') + '\n签到：' + signUrl), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = m.t + '.ics';
    a.click();
    toast(isMobile() ? '已唤起日历，请点"添加"' : '已生成 .ics，导入日历即可');
  }).catch(e => toast(e.message || '获取会议信息失败'));
}
