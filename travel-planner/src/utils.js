/* ============================================================
 * 旅途 · 旅游行程规划  utils.js
 * 纯函数 + 联网（天气/汇率）逻辑，不依赖 React。
 * ============================================================ */

export const LS_KEY = 'travel_planner_trips_v1';
export const LS_ACTIVE = 'travel_planner_active_v1';
export const LS_THEME = 'travel_planner_theme_v1';

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─────────── 存取 ─────────── */
export function normalizeTrip(t) {
  t.plan = (t.plan || []).map((d, i) => ({
    id: d.id || uid(),
    day: d.day || (i + 1),
    title: d.title != null ? d.title : `第 ${i + 1} 天`,
    city: d.city || '',
    nodes: Array.isArray(d.nodes)
      ? d.nodes.map(nd => { nd.images = Array.isArray(nd.images) ? nd.images : []; return nd; })
      : []
  }));
  t.plan.forEach((d, i) => { d.day = i + 1; });
  t.days = t.plan.length;
  if (t.insured !== undefined && !t.packing.some(c => c.cat === '购买旅行保险')) {
    const done = !!t.insured;
    t.packing.push({ cat: '购买旅行保险', items: [
      { id: uid(), name: '旅行意外险', qty: '1 份', done },
      { id: uid(), name: '医疗救援险', qty: '1 份', done },
      { id: uid(), name: '航班/行李延误险', qty: '1 份', done }
    ] });
  }
  delete t.insured;
  return t;
}

export function loadTrips() {
  let raw;
  try { raw = localStorage.getItem(LS_KEY); } catch (e) {}
  let trips = null;
  if (raw) { try { trips = JSON.parse(raw); } catch (e) { trips = null; } }
  if (!Array.isArray(trips)) trips = [];
  trips.forEach(normalizeTrip);
  if (trips.length) saveTrips(trips);
  return trips;
}

export function saveTrips(ts, onErr) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ts));
  } catch (e) {
    if (typeof onErr === 'function') onErr('⚠️ 本地存储已满（图片可能过多），已暂停自动保存；建议删减图片或导出 ZIP 备份');
  }
}

/* ─────────── 日期工具 ─────────── */
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d;
}
export const fmtDate = d => `${d.getMonth() + 1}月${d.getDate()}日`;
export const fmtWeek = d => '周' + '日一二三四五六'[d.getDay()];
export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function dayDate(trip, dayIdx) {
  if (!trip.startDate) return null;
  return addDays(trip.startDate, dayIdx - 1);
}
export function daysUntil(trip) {
  if (!trip.startDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(trip.startDate + 'T00:00:00') - today) / 86400000);
}

/* ─────────── 行前提醒模板 ─────────── */
export function buildReminders(trip) {
  if (!trip.startDate) return [];
  const t = [
    { off: -7, key: 'r7', text: '确认机票和酒店预订，查看出行期间天气' },
    { off: -3, key: 'r3', text: '检查身份证等证件，下载离线地图与出行 App' },
    { off: -1, key: 'r1', text: '打包行李（对照行李清单），办理线上值机' },
    { off: 0, key: 'r0', text: '出发！提前 2 小时到达机场，核对航班动态' }
  ];
  return t.map(r => ({ ...r, date: addDays(trip.startDate, r.off) }));
}

/* ─────────── 预算 / 打包统计 ─────────── */
export function tripBudget(t) {
  let cost = 0;
  t.transport.forEach(x => (cost += +x.price || 0));
  t.lodging.forEach(x => (cost += (+x.price || 0) * (+x.nights || 1)));
  t.plan.forEach(d => d.nodes.forEach(n => (cost += +n.cost || 0)));
  return cost;
}
export function packedStat(t) {
  let total = 0, done = 0;
  t.packing.forEach(c => c.items.forEach(i => { total++; if (i.done) done++; }));
  return { total, done };
}

/* ─────────── 图片 / 纯前端 ZIP ─────────── */
export function fileToResizedDataURL(file, maxW = 1000, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
export function dataURItoBytes(uri) {
  const bin = atob(uri.split(',')[1] || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
export function bytesToDataURI(bytes, name) {
  let mime = 'image/jpeg';
  const ext = (name && name.indexOf('.') >= 0) ? name.split('.').pop().toLowerCase() : '';
  if (ext === 'png') mime = 'image/png';
  else if (ext === 'gif') mime = 'image/gif';
  else if (ext === 'webp') mime = 'image/webp';
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

export const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
export async function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true); dv.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    chunks.push(local);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46); central.push(cen);
    offset += local.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}
export async function unzipFiles(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('not a zip');
  const cdOffset = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  const out = []; let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lnameLen = dv.getUint16(lho + 26, true);
    const lextraLen = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lnameLen + lextraLen;
    if (method !== 0) throw new Error('仅支持 store 模式');
    out.push({ name, data: buf.subarray(dataStart, dataStart + compSize) });
    p += 46 + nameLen + extraLen + commLen;
  }
  return out;
}
export async function buildTripZip(tripsList) {
  const imgMap = {};
  tripsList.forEach(tp => tp.plan.forEach(d => d.nodes.forEach(nd => (nd.images || []).forEach(im => { if (im.data && !imgMap[im.id]) imgMap[im.id] = im; }))));
  const exportTrips = JSON.parse(JSON.stringify(tripsList));
  exportTrips.forEach(tp => tp.plan.forEach(d => d.nodes.forEach(nd => { if (nd.images) nd.images = nd.images.map(im => ({ id: im.id, name: im.name })); })));
  const files = [{ name: 'trip.json', data: new TextEncoder().encode(JSON.stringify(exportTrips, null, 2)) }];
  for (const id in imgMap) {
    const im = imgMap[id];
    const bytes = dataURItoBytes(im.data);
    const ext = (im.name && im.name.indexOf('.') >= 0) ? im.name.split('.').pop().toLowerCase() : (im.data.indexOf('image/png') >= 0 ? 'png' : 'jpg');
    files.push({ name: `images/${id}.${ext}`, data: bytes });
  }
  return { blob: await makeZip(files), imgCount: Object.keys(imgMap).length };
}
export function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}
export function safeFileName(s) {
  return String(s || '行程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
}

/* ─────────── 全局粘贴自动识别（旅途行程粘贴格式 TPF v1）─────────── */
export function parseTripPaste(raw) {
  if (!raw || !raw.trim()) return { error: '请先粘贴行程内容' };
  const lines = String(raw).replace(/\r/g, '').split('\n').map(l => l.replace(/^\s*```.*$/, ''));
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*旅途行程\s*v1\s*$/i.test(lines[i])) { hi = i; break; }
  }
  if (hi < 0) return { error: '未识别到「旅途行程 v1」标识行，请确认复制了完整行程块' };
  const t = { id: uid(), name: '', emoji: '', destination: '', days: 0, nights: 0, startDate: null,
    transport: [], lodging: [], plan: [], packing: [], remindDone: {} };
  let curDay = null;
  const skipped = [];
  const packOrder = [], packMap = {};
  const numRe = /^\d+(\.\d+)?$/;
  const emojiRe = /^[^\p{L}\p{N}\s]+$/u;
  for (let i = hi + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^\[Day\]\s*(.+)$/i))) {
      const p = m[1].split('|').map(s => s.trim());
      let title = p[0] || '', city = p[1] || '';
      if (numRe.test(p[0] || '')) { title = p[1] || ''; city = p[2] || ''; }
      curDay = { day: 0, title: title || ('第' + (t.plan.length + 1) + '天'), city, nodes: [] };
      t.plan.push(curDay);
    } else if ((m = line.match(/^\[Node\]\s*(.+)$/i))) {
      if (!curDay) { skipped.push(line); continue; }
      const f = m[1].split('|').map(s => s.trim());
      let idx = 0;
      const time = /^\d{1,2}:\d{2}$/.test(f[0] || '') ? (idx = 1, f[0]) : '09:00';
      let icon = '📍';
      if (idx < f.length - 1 && f[idx] && emojiRe.test(f[idx])) { icon = f[idx]; idx++; }
      const title = f[idx++] || '';
      if (!title) { skipped.push(line); continue; }
      const loc = f[idx++] || '';
      const cost = (f[idx] && parseFloat(f[idx].replace(/[^\d.]/g, ''))) || 0; idx++;
      const desc = f.slice(idx).join(' | ') || '';
      curDay.nodes.push({ id: uid(), time, icon, title, loc, cost, desc, images: [] });
    } else if ((m = line.match(/^\[Transport\]\s*(.+)$/i))) {
      const f = m[1].split('|').map(s => s.trim());
      const type = /train|高铁|火车|🚄/.test(f[0] || '') ? 'train' : 'plane';
      t.transport.push({ id: uid(), type,
        label: f[1] || '行程段', from: f[2] || '', to: f[3] || '',
        flightNo: f[4] || '待定', depTime: f[5] || '待定', arrTime: f[6] || '待定',
        price: (f[7] && parseFloat(f[7].replace(/[^\d.]/g, ''))) || 0,
        booked: /^(true|1|是|已订|已购|yes)$/i.test(f[8] || '') });
    } else if ((m = line.match(/^\[Lodging\]\s*(.+)$/i))) {
      const f = m[1].split('|').map(s => s.trim());
      t.lodging.push({ id: uid(),
        name: f[0] || '住宿', type: f[2] || '酒店', nights: (f[3] && +f[3]) || 1,
        price: (f[4] && parseFloat(f[4].replace(/[^\d.]/g, ''))) || 0,
        address: f[5] || '',
        booked: /^(true|1|是|已订|已购|yes)$/i.test(f[6] || '') });
    } else if ((m = line.match(/^\[Packing\]\s*(.+)$/i))) {
      const f = m[1].split('|').map(s => s.trim());
      const cat = f[0] || '其他';
      if (!packMap[cat]) { packMap[cat] = []; packOrder.push(cat); }
      (f[1] || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean).forEach(name => {
        const qm = name.match(/^(.*?)[x×*](\d+)$/);
        packMap[cat].push({ id: uid(), name: qm ? qm[1].trim() : name, qty: qm ? qm[2] : '1', done: false });
      });
    } else if ((m = line.match(/^(名称|行程名|name)\s*[:：]\s*(.+)$/i))) {
      t.name = m[2].trim();
    } else if ((m = line.match(/^目的地\s*[:：]\s*(.+)$/i))) {
      t.destination = m[1].trim();
    } else if ((m = line.match(/^图标\s*[:：]\s*(.+)$/i))) {
      t.emoji = m[1].trim();
    } else if ((m = line.match(/^天数\s*[:：]\s*(\d+)$/i))) {
      t.days = +m[1];
    } else if ((m = line.match(/^晚数\s*[:：]\s*(\d+)$/i))) {
      t.nights = +m[1];
    } else if ((m = line.match(/^出发日期\s*[:：]\s*(.+)$/i))) {
      const dm = m[1].trim().match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
      if (dm) t.startDate = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
    } else {
      skipped.push(line);
    }
  }
  packOrder.forEach(c => t.packing.push({ cat: c, items: packMap[c] }));
  if (!t.plan.length) return { error: '没有解析到任何 [Day] 日程，请检查格式' };
  t.name = t.name || '未命名行程';
  t.destination = t.destination || t.name;
  t.days = t.plan.length;
  t.nights = t.nights || Math.max(t.plan.length - 1, 0);
  return { trip: t, skipped };
}

/* ─────────── 天气 & 汇率（实时联网）─────────── */
export const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
export const WX_API = 'https://api.open-meteo.com/v1/forecast';
export const RATE_API = 'https://open.er-api.com/v6/latest/CNY';
export const CN_REGIONS = ['CN', 'HK', 'MO', 'TW'];
export const FOREIGN_ALIAS = {
  '东京':'Tokyo','东京都':'Tokyo','大阪':'Osaka','京都':'Kyoto','奈良':'Nara','北海道':'Hokkaido','富士山':'Fuji','箱根':'Hakone','冲绳':'Okinawa','名古屋':'Nagoya',
  '首尔':'Seoul','济州':'Jeju','济州岛':'Jeju','釜山':'Busan',
  '曼谷':'Bangkok','清迈':'Chiang Mai','清莱':'Chiang Rai','普吉':'Phuket','苏梅':'Koh Samui','芭提雅':'Pattaya','甲米':'Krabi',
  '新加坡':'Singapore','吉隆坡':'Kuala Lumpur','兰卡威':'Langkawi','沙巴':'Kota Kinabalu','槟城':'Penang',
  '巴黎':'Paris','伦敦':'London','罗马':'Rome','米兰':'Milan','威尼斯':'Venice','马德里':'Madrid','巴塞罗那':'Barcelona','柏林':'Berlin','慕尼黑':'Munich','维也纳':'Vienna','阿姆斯特丹':'Amsterdam','苏黎世':'Zurich','布拉格':'Prague','佛罗伦萨':'Florence',
  '纽约':'New York','洛杉矶':'Los Angeles','旧金山':'San Francisco','夏威夷':'Honolulu','拉斯维加斯':'Las Vegas','芝加哥':'Chicago','西雅图':'Seattle','华盛顿':'Washington','迈阿密':'Miami',
  '悉尼':'Sydney','墨尔本':'Melbourne','黄金海岸':'Gold Coast','奥克兰':'Auckland','布里斯班':'Brisbane',
  '迪拜':'Dubai','伊斯坦布尔':'Istanbul','开普敦':'Cape Town','马尔代夫':'Maldives','巴厘岛':'Bali','吴哥窟':'Siem Reap','暹粒':'Siem Reap','河内':'Hanoi','胡志明市':'Ho Chi Minh City','岘港':'Da Nang','莫斯科':'Moscow','清迈':'Chiang Mai'
};
export const CC2CUR = { US:'USD',JP:'JPY',KR:'KRW',GB:'GBP',FR:'EUR',DE:'EUR',IT:'EUR',ES:'EUR',NL:'EUR',CH:'CHF',TH:'THB',SG:'SGD',MY:'MYR',AU:'AUD',CA:'CAD',NZ:'NZD',HK:'HKD',MO:'MOP',TW:'TWD',RU:'RUB',IN:'INR',ID:'IDR',VN:'VND',PH:'PHP',AE:'AED',TR:'TRY',BR:'BRL',MXN:'MXN',ZA:'ZAR',SE:'SEK',NO:'NOK',DK:'DKK',CZ:'CZK',PL:'PLN',HU:'HUF',PT:'EUR',IE:'EUR',AT:'EUR',BE:'EUR',GR:'EUR',FI:'EUR',EG:'EGP',IS:'ISK' };
export const CUR = { USD:{s:'$',z:'美元'}, JPY:{s:'¥',z:'日元'}, KRW:{s:'₩',z:'韩元'}, EUR:{s:'€',z:'欧元'}, GBP:{s:'£',z:'英镑'}, THB:{s:'฿',z:'泰铢'}, SGD:{s:'S$',z:'新加坡元'}, MYR:{s:'RM',z:'马来西亚林吉特'}, AUD:{s:'A$',z:'澳元'}, CAD:{s:'C$',z:'加元'}, NZD:{s:'NZ$',z:'新西兰元'}, CHF:{s:'Fr',z:'瑞士法郎'}, HKD:{s:'HK$',z:'港币'}, MOP:{s:'MOP$',z:'澳门元'}, TWD:{s:'NT$',z:'新台币'}, RUB:{s:'₽',z:'卢布'}, INR:{s:'₹',z:'印度卢比'}, IDR:{s:'Rp',z:'印尼盾'}, VND:{s:'₫',z:'越南盾'}, PHP:{s:'₱',z:'菲律宾比索'}, AED:{s:'د.إ',z:'迪拉姆'}, TRY:{s:'₺',z:'土耳其里拉'}, BRL:{s:'R$',z:'雷亚尔'}, MXN:{s:'$',z:'墨西哥比索'}, ZAR:{s:'R',z:'兰特'}, SEK:{s:'kr',z:'瑞典克朗'}, NOK:{s:'kr',z:'挪威克朗'}, DKK:{s:'kr',z:'丹麦克朗'}, CZK:{s:'Kč',z:'捷克克朗'}, PLN:{s:'zł',z:'兹罗提'}, HUF:{s:'Ft',z:'匈牙利福林'}, EGP:{s:'E£',z:'埃及镑'}, ISK:{s:'kr',z:'冰岛克朗'} };
export const WX = { 0:['☀️','晴'],1:['🌤️','晴间多云'],2:['⛅','多云'],3:['☁️','阴'],45:['🌫️','雾'],48:['🌫️','雾凇'],51:['🌦️','毛毛雨'],53:['🌦️','毛毛雨'],55:['🌦️','毛毛雨'],56:['🌧️','冻毛毛雨'],57:['🌧️','冻毛毛雨'],61:['🌧️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],66:['🌧️','冻雨'],67:['🌧️','冻雨'],71:['❄️','小雪'],73:['❄️','中雪'],75:['❄️','大雪'],77:['❄️','米雪'],80:['🌦️','阵雨'],81:['🌦️','阵雨'],82:['🌦️','强阵雨'],85:['🌨️','阵雪'],86:['🌨️','强阵雪'],95:['⛈️','雷阵雨'],96:['⛈️','雷暴冰雹'],99:['⛈️','雷暴冰雹'] };
export const wxIcon = c => (WX[c] || ['🌡️','未知'])[0];
export const wxText = c => (WX[c] || ['🌡️','未知'])[1];

const wxCache = {};
const rateCache = {};
const cityGeo = {};

export function isForeignGeo(g) { return !!(g && g.country_code && !CN_REGIONS.includes(g.country_code)); }

export async function geocode(dest) {
  try {
    const q = FOREIGN_ALIAS[dest.trim()] || dest.trim();
    const r = await fetch(`${GEO_API}?name=${encodeURIComponent(q)}&count=10&language=zh&format=json`);
    const j = await r.json();
    const list = j.results || [];
    if (!list.length) return null;
    const foreign = list.find(g => g.country_code && !CN_REGIONS.includes(g.country_code));
    const g = foreign || list[0];
    return { lat: g.latitude, lon: g.longitude, country: g.country, country_code: g.country_code, name: g.name };
  } catch (e) { return null; }
}
export async function fetchWeather(lat, lon, opts) {
  opts = opts || {};
  const rangeKey = opts.start && opts.end ? `${opts.start}~${opts.end}` : `f${opts.days || 16}`;
  const key = `${lat},${lon}|${rangeKey}`;
  const c = wxCache[key];
  if (c && Date.now() - c.ts < 1800000) return c.data;
  let url = `${WX_API}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`;
  if (opts.start && opts.end) url += `&start_date=${opts.start}&end_date=${opts.end}`;
  else url += `&forecast_days=${Math.min(opts.days || 16, 16)}`;
  const r = await fetch(url); const j = await r.json();
  const data = { current: j.current, daily: j.daily };
  wxCache[key] = { ts: Date.now(), data };
  return data;
}
export async function fetchRate(currency) {
  if (!currency) return null;
  const c = rateCache[currency];
  if (c && Date.now() - c.ts < 3600000) return c.data;
  try {
    const r = await fetch(RATE_API); const j = await r.json();
    if (j && j.rates && j.rates[currency] != null) {
      const data = { rate: j.rates[currency], updated: j.time_last_update_utc };
      rateCache[currency] = { ts: Date.now(), data };
      return data;
    }
  } catch (e) {}
  return null;
}
export async function geoCity(city) {
  const key = FOREIGN_ALIAS[city.trim()] || city.trim();
  if (cityGeo[key]) return cityGeo[key];
  const g = await geocode(key);
  if (g) cityGeo[key] = g;
  return g;
}

export function inheritCity(t, d) {
  const idx = t.plan.indexOf(d);
  for (let i = idx - 1; i >= 0; i--) if (t.plan[i].city) return t.plan[i].city;
  return t.destination || '';
}
export function effCity(t, d) { return (d.city && d.city.trim()) || inheritCity(t, d); }
export function distinctCities(t) {
  const seen = [], map = {};
  for (const d of t.plan) {
    const c = effCity(t, d);
    if (!c) continue;
    if (!map[c]) { map[c] = 1; seen.push(c); }
  }
  if (!seen.length && t.destination) seen.push(t.destination);
  return seen;
}
