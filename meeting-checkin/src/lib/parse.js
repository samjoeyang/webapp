/* AI 智能填会：粘贴解析 */
export const MEETING_LABELS = [
  ['t', /^(?:会议)?(?:标题|名称)$/],
  ['tm', /^(?:会议)?(?:时间|开始时间)$/],
  ['pl', /^(?:会议)?(?:地点|地址|场所)$/],
  ['i', /^(?:会议)?(?:简介|描述)$/],
  ['a', /^(?:会议)?(?:议程|日程|流程)$/],
  ['h', /^(?:是否)?(?:需要)?(?:手写)?签名$/],
  ['p', /^(?:管理)?(?:口令|密码)$/],
];

export function normDT(s) {
  s = String(s || '').trim();
  const m = s.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?\s*(?:(\d{1,2})\s*[:：点]\s*(\d{1,2})?)?/);
  if (!m) return '';
  const p = n => String(n).padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])}T${m[4] ? p(m[4]) : '09'}:${m[5] || '00'}`;
}

export function parseMeetingInfo(txt) {
  if (!txt) return null;
  const info = { t: '', tm: '', pl: '', i: '', a: [], h: 0, p: '' };
  let mode = null, seenTitle = false, seenOther = false;
  for (let raw of String(txt).replace(/\r/g, '').split('\n')) {
    let line = raw.trim();
    if (!line || /^```/.test(line)) continue;
    line = line.replace(/^[-*•>]\s+/, '').replace(/^\d+[.、)]\s+/, '')
      .replace(/\*\*/g, '').replace(/__/g, '').replace(/`/g, '').trim();
    if (!line) continue;
    const m = line.match(/^【([^】]+)】\s*(.*)$/) || line.match(/^([^：:]{1,8})[：:]\s*(.*)$/);
    if (m) {
      const key = m[1].replace(/\s/g, '');
      const hit = MEETING_LABELS.find(([, re]) => re.test(key));
      if (hit) {
        mode = hit[0];
        const val = m[2].trim();
        if (mode === 'a') { if (val) info.a.push(val); }
        else {
          info[mode] = val;
          if (mode === 't' && val) seenTitle = true;
          if (mode !== 't' && val) seenOther = true;
        }
        continue;
      }
    }
    if (mode === 'a' && line) info.a.push(line);
    else if (mode === 'i' && line && !info.i) info.i = line;
  }
  if (!seenTitle || !(seenOther || info.a.length)) return null;
  if (info.tm) info.tm = normDT(info.tm);
  info.h = /^(?:开启|开|是|需要|要|true|1|✓|✔|y|yes)$/i.test(info.h || '') ? 1 : 0;
  info.a = info.a.map(s => s.replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
  return info;
}
