/* ============================================================
 * 旅途 · 旅游行程规划  App.jsx  (React 重写)
 * 忠实复刻 app.js 的功能与中文 UI。
 * ============================================================ */
import { useRef, useState, useEffect, useLayoutEffect, useCallback, useReducer } from 'react';
import { createPortal } from 'react-dom';
import {
  loadTrips, saveTrips, normalizeTrip, uid, LS_THEME, LS_ACTIVE,
  buildTripZip, triggerDownload, unzipFiles, bytesToDataURI, safeFileName,
  parseTripPaste, distinctCities, daysUntil, packedStat, tripBudget,
  dayDate, fmtDate, fmtWeek, ymd, buildReminders,
  geoCity, fetchWeather, fetchRate, CC2CUR, CUR, wxIcon, wxText,
  isForeignGeo, effCity, inheritCity, fileToResizedDataURL, addDays
} from './utils.js';

/* ─────────── 配色主题 ─────────── */
const THEMES = [
  { id: '',       name: '晴空蓝', grad: 'linear-gradient(135deg, #2f6fed, #9b59f5)' },
  { id: 'green',  name: '青山绿', grad: 'linear-gradient(135deg, #0e9f6e, #38d9a9)' },
  { id: 'orange', name: '落日橙', grad: 'linear-gradient(135deg, #f76707, #e03131)' },
  { id: 'pink',   name: '樱花粉', grad: 'linear-gradient(135deg, #e64980, #be4bdb)' },
  { id: 'purple', name: '星空紫', grad: 'linear-gradient(135deg, #7048e8, #9775fa)' },
  { id: 'navy',   name: '深海蓝', grad: 'linear-gradient(135deg, #1c7ed6, #1864ab)' }
];
const NODE_ICONS = ['📍', '✈️', '🚄', '🏨', '🍜', '🍲', '🐼', '🏛️', '🛕', '🌉', '🍵', '🛍️', '🌿', '🎡', '🏖️', '🍺', '🎁'];
const TRIP_EMOJIS = ['🏝️', '🧳', '✈️', '🏖️', '🏔️', '🗼', '🎡', '🌃', '🌆', '🌴', '⛩️', '🏕️', '🚗', '🚢', '🐼', '🍜', '🎒', '🌏', '🎿', '🏰', '🌅'];

/* 打印视图使用的空 handler 集合（按钮都会被打印 CSS 隐藏，这里仅占位避免报错） */
const H0 = {
  save() {}, toast() {}, goTab() {}, openEditDest() {}, openDatePicker() {}, openClearDate() {},
  addDayAndEdit() {}, onHandleDown() {}, reorderPlan() {}, openNodeModal() {}, addDay() {},
  removeDay() {}, editDayTitle() {}, setDayCity() {}, onNodeGripDown() {}, moveNodeToDay() {},
  delNode() {}, openTicketModal() {}, openLodgeModal() {}, markAllBooked() {}, toggleTicket() {},
  toggleLodge() {}, delItem() {}, openItemModal() {}, toggleItem() {}, delItemPack() {},
  openCustomRemind() {}, toggleRemind() {}, delCustom() {}, askNotify() {}, openLightbox() {}
};

/* ─────────── 拖拽：总览卡片排序 ─────────── */
function startOverviewDrag(e, cardEl, reorderPlan) {
  if (!cardEl || cardEl.classList.contains('add-card')) return;
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const grid = cardEl.parentElement;
  const startX = e.clientX, startY = e.clientY;
  const rect = cardEl.getBoundingClientRect();
  const offX = startX - rect.left, offY = startY - rect.top;
  const pid = e.pointerId;
  let dragging = false, placeholder = null;
  const siblings = Array.from(grid.querySelectorAll('.tcard')).filter(c => c !== cardEl && !c.classList.contains('add-card'));
  function begin() {
    dragging = true;
    placeholder = document.createElement('div');
    placeholder.className = 'tcard placeholder';
    placeholder.style.width = rect.width + 'px';
    placeholder.style.height = rect.height + 'px';
    cardEl.parentNode.insertBefore(placeholder, cardEl);
    cardEl.style.position = 'fixed'; cardEl.style.zIndex = '999';
    cardEl.style.width = rect.width + 'px'; cardEl.style.height = rect.height + 'px';
    cardEl.style.left = rect.left + 'px'; cardEl.style.top = rect.top + 'px';
    cardEl.style.margin = '0'; cardEl.classList.add('dragging');
    try { cardEl.setPointerCapture(pid); } catch (_) {}
  }
  function move(ev) {
    if (!dragging) { if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return; begin(); }
    cardEl.style.left = (ev.clientX - offX) + 'px'; cardEl.style.top = (ev.clientY - offY) + 'px';
    const px = ev.clientX, py = ev.clientY; let ref = null;
    for (const s of siblings) {
      const r = s.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (py < cy - r.height / 2 || (py <= cy + r.height / 2 && px < cx)) { ref = s; break; }
    }
    if (ref) grid.insertBefore(placeholder, ref);
    else grid.insertBefore(placeholder, grid.querySelector('.add-card'));
  }
  function up() {
    cardEl.removeEventListener('pointermove', move);
    cardEl.removeEventListener('pointerup', up);
    cardEl.removeEventListener('pointercancel', up);
    if (!dragging) return;
    window.__justDragged = true;
    const order = Array.from(grid.children).filter(el =>
      !el.classList.contains('add-card') &&
      ((el.classList.contains('tcard') && el !== cardEl) || el === placeholder));
    const ids = order.map(el => (el === placeholder ? cardEl.dataset.id : el.dataset.id)).filter(Boolean);
    cardEl.style.position = ''; cardEl.style.left = ''; cardEl.style.top = ''; cardEl.style.zIndex = '';
    cardEl.style.width = ''; cardEl.style.height = ''; cardEl.style.margin = '';
    cardEl.classList.remove('dragging');
    if (placeholder) placeholder.remove();
    reorderPlan(ids);
  }
  cardEl.addEventListener('pointermove', move);
  cardEl.addEventListener('pointerup', up);
  cardEl.addEventListener('pointercancel', up);
}

/* ─────────── 拖拽：节点跨天移动 ─────────── */
function startNodeDrag(e, nodeEl, moveNodeToDay) {
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const pid = e.pointerId;
  const srcDay = +nodeEl.dataset.day;
  const nodeId = nodeEl.dataset.nid;
  let ghost = null, dragging = false, lastTarget = null, tl = null;
  function hitTimeline(x, y) {
    for (const el of document.querySelectorAll('.timeline')) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 14 && y <= r.bottom + 14) return el;
    }
    for (const b of document.querySelectorAll('.day-block')) {
      const r = b.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return b.querySelector('.timeline');
    }
    return null;
  }
  function begin() {
    dragging = true;
    const r = nodeEl.getBoundingClientRect();
    ghost = nodeEl.cloneNode(true);
    ghost.classList.add('node-ghost');
    ghost.style.width = r.width + 'px';
    ghost.style.left = (e.clientX - 24) + 'px';
    ghost.style.top = (e.clientY - 16) + 'px';
    document.body.appendChild(ghost);
    nodeEl.classList.add('node-dragging');
    try { nodeEl.setPointerCapture(pid); } catch (_) {}
  }
  function move(ev) {
    if (!dragging) { if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return; begin(); }
    ghost.style.left = (ev.clientX - 24) + 'px'; ghost.style.top = (ev.clientY - 16) + 'px';
    tl = hitTimeline(ev.clientX, ev.clientY);
    if (tl !== lastTarget) {
      document.querySelectorAll('.timeline.drop-active').forEach(x => x.classList.remove('drop-active'));
      if (tl) tl.classList.add('drop-active');
      lastTarget = tl;
    }
  }
  function up(ev) {
    nodeEl.removeEventListener('pointermove', move);
    nodeEl.removeEventListener('pointerup', up);
    nodeEl.removeEventListener('pointercancel', up);
    if (!dragging) return;
    const target = hitTimeline(ev.clientX, ev.clientY);
    if (ghost) ghost.remove();
    nodeEl.classList.remove('node-dragging');
    document.querySelectorAll('.timeline.drop-active').forEach(x => x.classList.remove('drop-active'));
    const tgtDay = target ? +target.closest('.day-block').dataset.day : null;
    moveNodeToDay(srcDay, nodeId, tgtDay);
  }
  nodeEl.addEventListener('pointermove', move);
  nodeEl.addEventListener('pointerup', up);
  nodeEl.addEventListener('pointercancel', up);
}

/* ─────────── 通用弹窗外壳 ─────────── */
function Modal({ onClose, children }) {
  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">{children}</div>
    </div>
  );
}

/* ─────────── 各弹窗 ─────────── */
function NewTripModal({ onCreate, onClose }) {
  const [name, setName] = useState('');
  const [dest, setDest] = useState('');
  const [emoji, setEmoji] = useState('🏝️');
  const [days, setDays] = useState(4);
  const [nights, setNights] = useState(3);
  return (
    <Modal onClose={onClose}><h3>新建行程</h3>
      <div className="form-row"><label>行程名称</label><input value={name} onChange={e => setName(e.target.value)} placeholder="如：三亚之旅" /></div>
      <div className="form-cols">
        <div className="form-row"><label>目的地</label><input value={dest} onChange={e => setDest(e.target.value)} placeholder="如：三亚" /></div>
        <div className="form-row"><label>图标 Emoji</label>
          <select value={emoji} onChange={e => setEmoji(e.target.value)}>
            <option value="">（不使用图标）</option>
            {TRIP_EMOJIS.map(em => <option key={em} value={em}>{em}</option>)}
          </select></div>
        <div className="form-row"><label>天数</label><input type="number" min="1" max="30" value={days} onChange={e => setDays(+e.target.value)} /></div>
        <div className="form-row"><label>晚数</label><input type="number" min="0" max="30" value={nights} onChange={e => setNights(+e.target.value)} /></div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" onClick={() => onCreate({ name, dest, emoji, days, nights })}>创建</button>
      </div>
    </Modal>
  );
}

function DatePickerModal({ t, save, onClose, toast }) {
  const [v, setV] = useState(t.startDate || '');
  return (
    <Modal onClose={onClose}><h3>确定出行日期</h3>
      <div className="notice">选择出发日期后：每天行程自动对应具体日期 → 自动生成行前提醒（购票 / 打包 / 值机）→ 可开启浏览器提醒。</div>
      <div className="form-row"><label>出发日期（第 1 天）</label>
        <input type="date" min={new Date().toISOString().slice(0, 10)} value={v} onChange={e => setV(e.target.value)} /></div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" onClick={() => { if (!v) return toast('请先选择日期'); t.startDate = v; save(); onClose(); toast('出行日期已确定，提醒已生成'); }}>保存</button>
      </div>
    </Modal>
  );
}

function ConfirmClearDateModal({ t, save, onClose }) {
  return (
    <Modal onClose={onClose}><h3>清除出行日期？</h3>
      <p style={{ color: 'var(--ink2)' }}>行程将恢复为「按天数」编排，已勾选的提醒状态会保留。</p>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn danger" onClick={() => { t.startDate = null; save(); onClose(); }}>确认清除</button>
      </div>
    </Modal>
  );
}

function NodeModal({ t, day, nodeId, save, onClose, toast }) {
  const d = t.plan.find(x => x.day === day);
  const n = nodeId ? d?.nodes.find(x => x.id === nodeId) : null;
  const [selDay, setSelDay] = useState(day);
  const [time, setTime] = useState(n?.time || '09:00');
  const [icon, setIcon] = useState(n?.icon || '📍');
  const [title, setTitle] = useState(n?.title || '');
  const [loc, setLoc] = useState(n?.loc || '');
  const [cost, setCost] = useState(n?.cost || 0);
  const [desc, setDesc] = useState(n?.desc || '');
  const [imgs, setImgs] = useState(n ? (n.images || []).map(x => ({ ...x })) : []);
  const onFiles = async e => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try { const data = await fileToResizedDataURL(f); setImgs(prev => [...prev, { id: uid(), name: f.name, data }]); }
      catch (_) { toast('图片读取失败'); }
    }
    e.target.value = '';
  };
  const saveNode = () => {
    if (!title.trim()) return toast('标题不能为空');
    const data = { time, icon, title: title.trim(), loc: loc.trim(), cost: +cost || 0, desc: desc.trim(), images: imgs };
    if (n) Object.assign(n, data);
    else { const td = t.plan.find(x => x.day === selDay); td.nodes.push({ id: uid(), ...data }); td.nodes.sort((a, b) => a.time.localeCompare(b.time)); }
    save(); onClose();
  };
  return (
    <Modal onClose={onClose}><h3>{n ? '编辑节点' : '添加节点'}</h3>
      {!n && <div className="form-row"><label>所属日期</label>
        <select value={selDay} onChange={e => setSelDay(+e.target.value)}>
          {t.plan.map(p => <option key={p.day} value={p.day}>Day {p.day} · {p.title}</option>)}
        </select></div>}
      <div className="form-cols">
        <div className="form-row"><label>时间</label><input type="time" value={time} onChange={e => setTime(e.target.value)} /></div>
        <div className="form-row"><label>图标</label>
          <select value={icon} onChange={e => setIcon(e.target.value)}>
            {NODE_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
          </select></div>
      </div>
      <div className="form-row"><label>标题</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="如：宽窄巷子" /></div>
      <div className="form-row"><label>地点</label><input value={loc} onChange={e => setLoc(e.target.value)} placeholder="可选" /></div>
      <div className="form-row"><label>人均花费（元）</label><input type="number" min="0" value={cost} onChange={e => setCost(e.target.value)} /></div>
      <div className="form-row"><label>描述</label><textarea rows="3" value={desc} onChange={e => setDesc(e.target.value)} placeholder="玩法提示、预约提醒、推荐菜……" /></div>
      <div className="form-row"><label>图片（图文混排 · 可多张）</label>
        <input type="file" accept="image/*" multiple onChange={onFiles} />
        <div className="img-wrap">
          {imgs.map(im => <div className="img-thumb" key={im.id}><img src={im.data} alt={im.name || ''} />
            <button type="button" className="img-x" onClick={() => setImgs(prev => prev.filter((_, j) => j !== imgs.indexOf(im)))}>✕</button></div>)}
        </div>
        <div className="tip">图片会自动压缩后随行程保存；单张建议 ≤ 1MB，过多会触达浏览器本地存储上限。</div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn pri" onClick={saveNode}>保存</button>
      </div>
    </Modal>
  );
}

function TicketModal({ t, id, save, onClose }) {
  const x = id ? t.transport.find(i => i.id === id) : null;
  const SEGS = ['去程', '在途', '返程'];
  const [type, setType] = useState(x?.type || 'plane');
  const [seg, setSeg] = useState(x?.label || '去程');
  const [custom, setCustom] = useState(SEGS.includes(x?.label) ? '' : (x?.label || ''));
  const [from, setFrom] = useState(x?.from || '');
  const [to, setTo] = useState(x?.to || '');
  const [no, setNo] = useState(x?.flightNo || '');
  const [dep, setDep] = useState(x && x.depTime && /^\d{1,2}:\d{2}$/.test(x.depTime) ? x.depTime : '');
  const [arr, setArr] = useState(x && x.arrTime && /^\d{1,2}:\d{2}$/.test(x.arrTime) ? x.arrTime : '');
  const [price, setPrice] = useState(x?.price || 0);
  const label = seg === '__custom__' ? (custom.trim() || '行程段') : seg;
  const saveT = () => {
    const data = { type, label, from: from.trim(), to: to.trim(), flightNo: no.trim() || '待定', depTime: dep.trim() || '待定', arrTime: arr.trim() || '待定', price: +price || 0 };
    if (x) Object.assign(x, data); else t.transport.push({ id: uid(), booked: false, ...data });
    save(); onClose();
  };
  return (
    <Modal onClose={onClose}><h3>{x ? '编辑' : '添加'}车票/机票</h3>
      <div className="form-cols">
        <div className="form-row"><label>类型</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="plane">✈️ 飞机</option><option value="train">🚄 高铁/火车</option>
          </select></div>
        <div className="form-row"><label>行程段</label>
          <select value={seg} onChange={e => setSeg(e.target.value)}>
            <option value="去程">去程</option><option value="在途">在途</option><option value="返程">返程</option>
            <option value="__custom__">＋ 自定义…</option>
          </select></div>
        {seg === '__custom__' && <div className="form-row"><label>自定义行程段名称</label><input value={custom} onChange={e => setCustom(e.target.value)} placeholder="如：中转停留" /></div>}
        <div className="form-row"><label>出发地</label><input value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div className="form-row"><label>到达地</label><input value={to} onChange={e => setTo(e.target.value)} /></div>
        <div className="form-row"><label>班次/航班号</label><input value={no} onChange={e => setNo(e.target.value)} placeholder="如 MU5401 / G1023" /></div>
        <div className="form-row"><label>出发时间</label><input type="time" value={dep} onChange={e => setDep(e.target.value)} /></div>
        <div className="form-row"><label>到达时间</label><input type="time" value={arr} onChange={e => setArr(e.target.value)} /></div>
        <div className="form-row"><label>票价（元/人）</label><input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></div>
      </div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button><button className="btn pri" onClick={saveT}>保存</button></div>
    </Modal>
  );
}

function LodgeModal({ t, id, save, onClose, toast }) {
  const x = id ? t.lodging.find(i => i.id === id) : null;
  const [name, setName] = useState(x?.name || '');
  const [type, setType] = useState(x?.type || '酒店');
  const [nights, setNights] = useState(x?.nights || t.nights);
  const [price, setPrice] = useState(x?.price || 0);
  const [addr, setAddr] = useState(x?.address || '');
  const saveL = () => {
    const data = { name: name.trim(), type: type.trim(), nights: +nights || 1, price: +price || 0, address: addr.trim() };
    if (!data.name) return toast('名称不能为空');
    if (x) Object.assign(x, data); else t.lodging.push({ id: uid(), booked: false, ...data });
    save(); onClose();
  };
  return (
    <Modal onClose={onClose}><h3>{x ? '编辑' : '添加'}住宿</h3>
      <div className="form-row"><label>名称</label><input value={name} onChange={e => setName(e.target.value)} placeholder="酒店 / 民宿名称" /></div>
      <div className="form-cols">
        <div className="form-row"><label>类型</label><input value={type} onChange={e => setType(e.target.value)} /></div>
        <div className="form-row"><label>晚数</label><input type="number" min="1" value={nights} onChange={e => setNights(e.target.value)} /></div>
        <div className="form-row"><label>价格（元/晚）</label><input type="number" min="0" value={price} onChange={e => setPrice(e.target.value)} /></div>
        <div className="form-row"><label>地址</label><input value={addr} onChange={e => setAddr(e.target.value)} /></div>
      </div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button><button className="btn pri" onClick={saveL}>保存</button></div>
    </Modal>
  );
}

function ItemModal({ t, save, onClose, toast }) {
  const [cat, setCat] = useState(t.packing[0]?.cat || '');
  const [custom, setCustom] = useState('');
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const isNew = cat === '__new__';
  const saveI = () => {
    let c = isNew ? (custom.trim() || '其他') : cat; c = c || '其他';
    const nm = name.trim(); if (!nm) return toast('请填写物品名称');
    let cc = t.packing.find(x => x.cat === c);
    if (!cc) { cc = { cat: c, items: [] }; t.packing.push(cc); }
    cc.items.push({ id: uid(), name: nm, qty: qty.trim() || '1', done: false });
    save(); onClose();
  };
  return (
    <Modal onClose={onClose}><h3>添加物品</h3>
      <div className="form-row"><label>分类</label>
        <select value={cat} onChange={e => setCat(e.target.value)}>
          {t.packing.map(c => <option key={c.cat} value={c.cat}>{c.cat}</option>)}
          <option value="__new__">＋ 新建分类…</option>
        </select></div>
      {isNew && <div className="form-row"><label>新分类名称</label><input value={custom} onChange={e => setCustom(e.target.value)} placeholder="如：摄影器材" /></div>}
      <div className="form-cols">
        <div className="form-row"><label>物品名称</label><input value={name} onChange={e => setName(e.target.value)} placeholder="如：墨镜" /></div>
        <div className="form-row"><label>数量</label><input value={qty} onChange={e => setQty(e.target.value)} /></div>
      </div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button><button className="btn pri" onClick={saveI}>保存</button></div>
    </Modal>
  );
}

function CustomRemindModal({ t, save, onClose, toast }) {
  const [date, setDate] = useState(t.startDate || '');
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const saveC = () => {
    const tx = text.trim(); const dt = date;
    if (!tx || !dt) return toast('请填写日期和内容');
    (t.customReminds = t.customReminds || []).push({ id: uid(), date: dt, label: label.trim() || '提醒', text: tx });
    save(); onClose();
  };
  return (
    <Modal onClose={onClose}><h3>添加自定义提醒</h3>
      <div className="form-row"><label>提醒日期</label><input type="date" min="2000-01-01" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div className="form-row"><label>标签</label><input value={label} onChange={e => setLabel(e.target.value)} placeholder="如：D-2 / 当天上午" /></div>
      <div className="form-row"><label>内容</label><input value={text} onChange={e => setText(e.target.value)} placeholder="如：去银行换港币" /></div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button><button className="btn pri" onClick={saveC}>保存</button></div>
    </Modal>
  );
}

function EditDestModal({ t, save, onClose, toast }) {
  const [v, setV] = useState(t.destination);
  const saveE = () => { const val = v.trim(); if (!val) return toast('请填写目的地'); t.destination = val; save(); onClose(); toast('已更新，天气将按各城市重新获取'); };
  return (
    <Modal onClose={onClose}><h3>📍 修改目的地</h3>
      <div className="notice">修改后会自动重新定位，并刷新天气与汇率。</div>
      <div className="form-row"><label>目的地</label><input value={v} onChange={e => setV(e.target.value)} placeholder="城市或国家，如：东京 / 曼谷" /></div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>取消</button><button className="btn pri" onClick={saveE}>保存并重定位</button></div>
    </Modal>
  );
}

function DeleteTripModal({ t, onlyOne, onDelete, onBackupDelete, onClose }) {
  return (
    <Modal onClose={onClose}><h3>删除行程</h3>
      <div className="del-tip">
        <div className="del-name">{t.emoji ? t.emoji + ' ' : ''}{t.name}</div>
        <p>删除后<b>无法恢复</b>，建议先导出一份备份（ZIP，含行程里的图片）。</p>
        {onlyOne && <p className="warn">这是当前最后一个行程，删除后将不剩任何行程（可随时重新创建）。</p>}
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn danger solid" onClick={onDelete}>直接删除</button>
        <button className="btn pri" onClick={onBackupDelete}>先导出备份并删除</button>
      </div>
    </Modal>
  );
}

function ThemeModal({ cur, onPick, onClose }) {
  return (
    <Modal onClose={onClose}><h3>🎨 选择配色</h3>
      <div className="theme-grid">
        {THEMES.map(th => (
          <button key={th.id} className={`theme-swatch ${th.id === cur ? 'active' : ''}`} data-t={th.id} onClick={() => onPick(th.id)}>
            <div className="theme-dot" style={{ background: th.grad }}></div>{th.name}
          </button>
        ))}
      </div>
      <div className="modal-foot"><button className="btn" onClick={onClose}>关闭</button></div>
    </Modal>
  );
}

/* ─────────── 各 Tab 面板 ─────────── */
function Overview({ t, h, print }) {
  const cities = distinctCities(t);
  const [activeCity, setActiveCity] = useState(cities[0] || '');
  const [wx, setWx] = useState(null);
  const [wxLoading, setWxLoading] = useState(false);
  const [rate, setRate] = useState(null);
  const [rateLoading, setRateLoading] = useState(false);

  const loadCity = useCallback(async city => {
    setWxLoading(true); setWx(null); setRate(null);
    const g = await geoCity(city);
    if (!g) { setWx('fail'); setWxLoading(false); return; }
    if (isForeignGeo(g)) {
      const cur = CC2CUR[g.country_code];
      if (cur) { setRateLoading(true); const rt = await fetchRate(cur); setRate(rt ? { ...rt, cur, city } : { none: true }); setRateLoading(false); }
      else setRate({ none: true });
    } else setRate(null);
    let opts = { days: t.days || 1 };
    if (t.startDate) {
      const s = new Date(t.startDate + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0);
      const diff = Math.round((s - today) / 86400000);
      if (diff >= 0 && diff <= 16) { const e = new Date(s); e.setDate(s.getDate() + (t.days || 1) - 1); opts = { start: ymd(s), end: ymd(e) }; }
    }
    const d = await fetchWeather(g.lat, g.lon, opts);
    const tripDays = {};
    if (t.startDate) for (let n = 1; n <= t.days; n++) { const dd = dayDate(t, n); if (dd && effCity(t, t.plan[n - 1]) === city) tripDays[ymd(dd)] = n; }
    setWx({ current: d.current, daily: d.daily, tripDays }); setWxLoading(false);
  }, [t.id, t.startDate, t.days, t.plan]);

  useEffect(() => {
    if (!cities.length) { setWx(null); setRate(null); return; }
    const c = cities.includes(activeCity) ? activeCity : cities[0];
    if (c !== activeCity) setActiveCity(c);
    loadCity(c);
  }, [t.id, t.startDate, t.days, t.plan, activeCity, cities.join('|'), loadCity]);

  const du = daysUntil(t);
  const badge = t.startDate
    ? <span className="badge ok">✅ 出行日期已确定 · {fmtDate(new Date(t.startDate + 'T00:00:00'))}</span>
    : <span className="badge">🕓 出行日期待定 · 行程先按第 1~{t.days} 天编排</span>;
  const countdown = du !== null && du >= 0
    ? <div className="countdown"><div className="num">{du}</div><div className="lbl">天后出发</div></div> : null;
  const { total, done } = packedStat(t);
  const allItems = [...t.transport, ...t.lodging];
  const bookedCount = allItems.filter(x => x.booked).length;
  const hasTickets = allItems.length > 0;
  const bookedAll = hasTickets && bookedCount === allItems.length;
  const bookLabel = !hasTickets ? '待规划' : (bookedAll ? '已订齐' : `未订齐 ${bookedCount}/${allItems.length}`);

  return (
    <div className="tab-panel">
      <div className="hero">
        <div className="hero-bg">🐼</div>
        <div className="dest">{t.emoji ? t.emoji + ' ' : ''}{t.destination}</div>
        <div className="meta">{t.name} · {t.days} 天 {t.nights} 晚 · 共 {t.plan.reduce((s, d) => s + d.nodes.length, 0)} 个行程节点</div>
        {badge}
        {countdown}
      </div>
      <div className="stat-grid">
        <div className="stat"><div className="v">¥{tripBudget(t).toLocaleString()}</div><div className="k">预算合计（预估）</div></div>
        <div className="stat"><div className="v">{total ? Math.round(done / total * 100) : 0}%</div><div className="k">行李打包进度</div></div>
        <div className="stat"><div className="v">{bookLabel}</div><div className="k">机票/酒店状态</div></div>
        <div className="stat"><div className="v">{t.startDate ? 'D' + (du >= 0 ? du : '日') : '—'}</div><div className="k">距出发</div></div>
      </div>

      <h2 className="section">🌤 途经城市天气 <span className="tip">{cities.length > 1 ? ('共 ' + cities.length + ' 城 · 点击上方城市切换') : '根据行程城市自动获取'}</span>
        <span style={{ flex: 1 }}></span>
        <button className="link" onClick={h.openEditDest}>✏️ 行程目的地</button></h2>
      <div className="wx-box">
        {!cities.length
          ? <div className="empty">在「每日行程」里给每一天设置所在城市后，这里会自动显示对应天气与汇率 🌤</div>
          : wxLoading ? <div className="wx-loading">🌍 正在获取 {activeCity} 的天气…</div>
          : wx === 'fail' ? <div className="empty">未能定位「{activeCity}」，请检查城市名称或网络</div>
          : wx ? <>
              <div className="city-chips">{cities.map(c => <button key={c} className={`city-chip ${c === activeCity ? 'active' : ''}`} onClick={() => setActiveCity(c)}>{c}</button>)}</div>
              <div className="wx-now">
                <div className="wx-emoji">{wxIcon(wx.current.weather_code)}</div>
                <div><div className="wx-temp">{Math.round(wx.current.temperature_2m)}°</div><div className="wx-desc">{wxText(wx.current.weather_code)}</div><div className="wx-loc">{activeCity} · 现在</div></div>
                <div className="wx-extra">💧 {wx.current.relative_humidity_2m}% · 💨 {Math.round(wx.current.wind_speed_10m)} km/h</div>
              </div>
              <div className="wx-forecast">{wx.daily.time.slice(0, t.days || wx.daily.time.length).map((dt, i) => {
                const dtObj = new Date(dt + 'T00:00:00'); const dn = wx.tripDays[dt];
                return <div key={dt} className={`wx-day ${dn ? 'inday' : ''}`}>
                  <div className="wx-d">{dn ? ('Day ' + dn) : (dt.slice(5).replace('-', '/') + ' ' + fmtWeek(dtObj))}</div>
                  <div className="wx-de">{wxIcon(wx.daily.weather_code[i])}</div>
                  <div className="wx-t">{Math.round(wx.daily.temperature_2m_max[i])}°/{Math.round(wx.daily.temperature_2m_min[i])}°</div>
                </div>;
              })}</div>
            </>
          : null}
      </div>
      <div>
        {rateLoading ? <div className="rate-loading">💱 正在获取汇率…</div>
          : rate && rate.none ? <div className="empty">该目的地暂未配置汇率</div>
          : rate && rate.rate ? <div className="rate-card">
              <div className="rate-title">💱 境外汇率参考 · {rate.city}</div>
              <div className="rate-main"><span className="rs">{CUR[rate.cur]?.s || ''}</span> 1 {rate.cur} ≈ <b>¥{(1 / rate.rate).toFixed(3)}</b></div>
              <div className="rate-sub">100 人民币 ≈ <b>{CUR[rate.cur]?.s || ''}{(rate.rate * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}</b> · 1 人民币 ≈ {rate.rate.toFixed(4)} {rate.cur}</div>
              <div className="rate-upd">更新：{(rate.updated || '').toString().slice(0, 16) || '—'}</div>
            </div>
          : null}
      </div>

      <h2 className="section">📅 出行日期</h2>
      {t.startDate
        ? <div className="date-bar set"><span>🧭 出发日期：<b>{t.startDate}</b>（{fmtWeek(new Date(t.startDate + 'T00:00:00'))}），每日行程已自动对应具体日期。</span><button className="btn" onClick={h.openDatePicker}>修改日期</button><button className="btn danger" onClick={h.openClearDate}>清除日期</button></div>
        : <div className="date-bar"><span className="txt">🕓 还没定出发日期？先把行程按「第几天」规划好，<b>确定日期后每天会自动映射到具体日期</b>，并生成行前提醒。</span><button className="btn pri" onClick={h.openDatePicker}>确定出行日期</button></div>}

      <h2 className="section">🗺️ 行程速览 <span className="tip">拖动卡片右上角 ⠿ 可调整顺序 · 点击卡片进入每日行程编辑</span></h2>
      <div className="card-grid">
        {t.plan.map(d => {
          const dt = dayDate(t, d.day);
          return (
            <div className="tcard" key={d.id} data-id={d.id} style={{ cursor: 'pointer' }} onClick={() => h.goTab('itinerary')}>
              {!print && <span className="drag-handle" title="拖动排序" onPointerDown={e => h.onHandleDown(e, e.currentTarget.closest('.tcard'))}>⠿</span>}
              <div className="route"><span>Day {d.day}</span><span className="arrow">{dt ? fmtDate(dt) + ' ' + fmtWeek(dt) : '日期待定'}</span></div>
              <div className="detail"><div>{d.title}</div><div>{d.nodes.map(n => n.icon).join(' ')} · {d.nodes.length} 个节点</div></div>
            </div>
          );
        })}
        {!print && <div className="tcard add-card" onClick={h.addDayAndEdit}><div className="add-plus">＋</div><div className="add-label">增加一天</div></div>}
      </div>
    </div>
  );
}

function Itinerary({ t, h, print }) {
  const [dayWx, setDayWx] = useState({});
  useEffect(() => {
    if (!t.startDate) { setDayWx({}); return; }
    let cancelled = false;
    t.plan.forEach(d => {
      const c = effCity(t, d); if (!c) return;
      (async () => {
        let wd = null;
        try { const g = await geoCity(c); if (!g) { if (!cancelled) setDayWx(p => ({ ...p, [d.day]: { fail: true, c } })); return; } wd = await fetchWeather(g.lat, g.lon); }
        catch (e) { if (!cancelled) setDayWx(p => ({ ...p, [d.day]: { fail: true, c } })); return; }
        const dd = dayDate(t, d.day); if (!dd) return;
        const idx = wd.daily.time.indexOf(ymd(dd));
        if (!cancelled) setDayWx(p => ({ ...p, [d.day]: idx >= 0
          ? { code: wd.daily.weather_code[idx], max: Math.round(wd.daily.temperature_2m_max[idx]), min: Math.round(wd.daily.temperature_2m_min[idx]) }
          : { later: true, c } }));
      })();
    });
    return () => { cancelled = true; };
  }, [t.id, t.startDate, t.plan]);

  return (
    <div className="tab-panel">
      <h2 className="section">🗓️ 每日行程时间轴 <span className="tip">节点可新增 / 编辑 / 删除，按住左侧 ⠿ 可拖到其它日期</span>
        <span style={{ flex: 1 }}></span>
        {!print && <button className="btn pri" onClick={() => h.openNodeModal(t.plan[0]?.day || 1)}>＋ 添加节点</button>}
      </h2>
      {t.plan.map(d => {
        const dt = dayDate(t, d.day);
        const inh = inheritCity(t, d);
        const ph = d.city ? '' : (inh ? '沿用：' + inh : '设置本日城市');
        return (
          <div className="day-block" key={d.id} data-day={d.day}>
            <div className="day-head">
              <span className="day-tag">Day {d.day}</span>
              <input className="day-title" style={{ border: 'none', background: 'transparent', fontSize: '16px', fontWeight: 700, width: '200px' }}
                value={d.title} readOnly={print} onChange={e => h.editDayTitle(d.day, e.target.value)} />
              <input className={`day-city ${d.city ? '' : 'inherited'}`} value={d.city || ''} placeholder={ph} readOnly={print}
                title="本日所在城市，天气按城市切换" onChange={e => h.setDayCity(d.day, e.target.value)} />
              <span className="day-date">{dt ? `${fmtDate(dt)} ${fmtWeek(dt)}` : '日期待定'}</span>
              <span className="spacer"></span>
              <span className="day-date">当日预估 ¥{d.nodes.reduce((s, n) => s + (+n.cost || 0), 0)}</span>
              <span>{dayWx[d.day]
                ? (dayWx[d.day].fail
                    ? <span className="day-wx" style={{ background: 'var(--line)', color: 'var(--ink2)' }}>📍 {dayWx[d.day].c} 定位失败</span>
                    : dayWx[d.day].later
                      ? <span className="day-wx" style={{ background: 'var(--line)', color: 'var(--ink2)' }}>🗓 临近再看</span>
                      : <span className="day-wx" title={dayWx[d.day].c + ' 当日天气'}>{wxIcon(dayWx[d.day].code)} {dayWx[d.day].max}°/{dayWx[d.day].min}°</span>)
                : null}</span>
              {!print && t.plan.length > 1 && <button className="day-del" title="删除这一天" onClick={() => h.removeDay(d.day)}>🗑</button>}
            </div>
            <div className="timeline">
              {d.nodes.length ? d.nodes.map(n => (
                <div className="node" key={n.id} data-day={d.day} data-nid={n.id}>
                  <div className="node-head">
                    {!print && <span className="node-grip" title="拖拽到其它日期调整所属天" onPointerDown={e => h.onNodeGripDown(e, e.currentTarget.closest('.node'))}>⠿</span>}
                    <span className="node-icon">{n.icon || '📍'}</span>
                    <span className="node-time">{n.time}</span>
                    <span className="node-title">{n.title}</span>
                    {n.loc && <span className="node-loc">📍 {n.loc}</span>}
                    {n.cost ? <span className="node-cost">¥{n.cost}/人</span> : null}
                  </div>
                  {n.desc && <div className="node-desc">{n.desc}</div>}
                  {n.images && n.images.length
                    ? <div className="node-gallery">{n.images.map(im => <img className="node-img" key={im.id} src={im.data} loading="lazy" onClick={() => h.openLightbox(im.data)} alt={im.name || ''} />)}</div>
                    : null}
                  {!print && <div className="node-ops">
                    <button className="mini" onClick={() => h.openNodeModal(d.day, n.id)}>✏️ 编辑</button>
                    <button className="mini del" onClick={() => h.delNode(d.day, n.id)}>🗑 删除</button>
                  </div>}
                </div>
              )) : <div className="empty">这一天还没有安排，点上方「添加节点」开始规划 ✍️</div>}
            </div>
          </div>
        );
      })}
      {!print && <div className="day-foot">
        <button className="btn pri" onClick={h.addDay}>＋ 增加一天</button>
        <span className="tip">当前共 {t.plan.length} 天 · 删除某天请用该天标题旁的 🗑（会一并删除当天所有节点）</span>
      </div>}
    </div>
  );
}

function Transport({ t, h, print }) {
  const icon = x => x.type === 'plane' ? '✈️' : '🚄';
  return (
    <div className="tab-panel">
      <h2 className="section">🎫 大交通 <span className="tip">出发日期确定后，按提醒及时购票</span>
        <span style={{ flex: 1 }}></span>
        {!print && <><button className="btn pri" onClick={h.openTicketModal}>＋ 添加车票/机票</button>
          <button className="btn ghost" onClick={() => h.markAllBooked('transport')}>{(t.transport.length && t.transport.every(x => x.booked)) ? '↩ 取消全部已购' : '✅ 全部标记已购'}</button></>}
      </h2>
      <div className="card-grid">
        {t.transport.length ? t.transport.map(x => (
          <div className="tcard" key={x.id}>
            <div className="route"><span>{icon(x)} {x.label} · {x.from} → {x.to}</span></div>
            <div className="detail"><div>班次：{x.flightNo}　{x.depTime} → {x.arrTime}</div><div>票价：{x.price ? `¥${x.price}/人` : '待定'}</div></div>
            <div className="badges"><span className={`tag ${x.booked ? 'ok' : 'warn'}`}>{x.booked ? '✅ 已购票' : '⏳ 待购票'}</span>
              {!print && <><button className="mini" style={{ border: '1px solid var(--line)', borderRadius: '8px', background: '#fff', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.toggleTicket(x.id)}>{x.booked ? '标记待购' : '标记已购'}</button>
              <button className="mini" style={{ border: '1px solid var(--line)', borderRadius: '8px', background: '#fff', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.openTicketModal(x.id)}>✏️ 编辑</button>
              <button className="mini" style={{ border: '1px solid #fdecec', borderRadius: '8px', background: '#fff', color: 'var(--danger)', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.delItem('transport', x.id)}>🗑</button></>}
            </div>
          </div>
        )) : <div className="empty">还没有添加车票/机票</div>}
      </div>

      <h2 className="section">🏨 住宿
        <span style={{ flex: 1 }}></span>
        {!print && <><button className="btn pri" onClick={h.openLodgeModal}>＋ 添加住宿</button>
          <button className="btn ghost" onClick={() => h.markAllBooked('lodging')}>{(t.lodging.length && t.lodging.every(x => x.booked)) ? '↩ 取消全部已订' : '✅ 全部标记已订'}</button></>}
      </h2>
      <div className="card-grid">
        {t.lodging.length ? t.lodging.map(x => (
          <div className="tcard" key={x.id}>
            <div className="route"><span>🏨 {x.name}</span><span className="arrow">{x.nights} 晚</span></div>
            <div className="detail"><div>{x.type} · {x.address || '地址待定'}</div><div>价格：{x.price ? `¥${x.price}/晚 · 合计 ¥${x.price * x.nights}` : '待定'}</div></div>
            <div className="badges"><span className={`tag ${x.booked ? 'ok' : 'warn'}`}>{x.booked ? '✅ 已预订' : '⏳ 待预订'}</span>
              {!print && <><button className="mini" style={{ border: '1px solid var(--line)', borderRadius: '8px', background: '#fff', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.toggleLodge(x.id)}>{x.booked ? '标记待订' : '标记已订'}</button>
              <button className="mini" style={{ border: '1px solid var(--line)', borderRadius: '8px', background: '#fff', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.openLodgeModal(x.id)}>✏️ 编辑</button>
              <button className="mini" style={{ border: '1px solid #fdecec', borderRadius: '8px', background: '#fff', color: 'var(--danger)', padding: '2px 10px', fontSize: '12px' }} onClick={() => h.delItem('lodging', x.id)}>🗑</button></>}
            </div>
          </div>
        )) : <div className="empty">还没有添加住宿</div>}
      </div>
    </div>
  );
}

function Packing({ t, h, print }) {
  const { total, done } = packedStat(t);
  return (
    <div className="tab-panel">
      <h2 className="section">🎒 行李物品清单
        <span style={{ flex: 1 }}></span>
        {!print && <button className="btn pri" onClick={h.openItemModal}>＋ 添加物品</button>}
      </h2>
      <div className="progress-wrap"><div className="progress"><div style={{ width: (total ? done / total * 100 : 0) + '%' }}></div></div>
        <span style={{ fontSize: '13px', color: 'var(--ink2)' }}>{done} / {total} 已打包</span></div>
      <div className="pack-cats">
        {t.packing.map((c, ci) => (
          <div className="pack-cat" key={c.cat}>
            <h3><span>{c.cat}</span><span>{c.items.filter(i => i.done).length}/{c.items.length}</span></h3>
            {c.items.map(i => (
              <label className={`pack-item ${i.done ? 'done' : ''}`} key={i.id}>
                <input type="checkbox" checked={i.done} disabled={print} onChange={() => h.toggleItem(ci, i.id)} />
                <span>{i.name}</span><span className="qty">×{i.qty}</span>
                {!print && <button className="del" onClick={e => { e.preventDefault(); h.delItemPack(ci, i.id); }}>✕</button>}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Remind({ t, h, print }) {
  if (!t.startDate) return (
    <div className="tab-panel"><div className="empty" style={{ padding: '60px 20px' }}>
      <div style={{ fontSize: '44px' }}>🔔</div>
      <p style={{ marginTop: '12px' }}>出行日期确定后，这里会自动生成行前提醒：<br /><b>D-7</b> 确认预订与天气 · <b>D-3</b> 证件与离线地图 · <b>D-1</b> 打包值机 · <b>D0</b> 出发</p>
      {!print && <button className="btn pri" style={{ marginTop: '18px' }} onClick={h.openDatePicker}>去确定出行日期</button>}
    </div></div>
  );
  const rs = buildReminders(t);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const custom = t.customReminds || [];
  return (
    <div className="tab-panel">
      <h2 className="section">🔔 行前提醒</h2>
      <div className="notice">📬 每次打开本页面时，若当天有待办提醒且已授权通知权限，会自动弹出浏览器通知。行程：出发日 {t.startDate}</div>
      {!print && <button className="btn" style={{ marginBottom: '16px' }} onClick={h.askNotify}>开启浏览器通知权限</button>}
      {rs.map(r => {
        const done = t.remindDone[r.key]; const past = r.date < today;
        return (
          <div className={`remind-item ${done ? 'done' : ''} ${past ? 'past' : ''}`} key={r.key}>
            <span className="when">{r.off === 0 ? '出发当天' : 'D' + r.off}</span>
            <span className="txt"><b>{fmtDate(r.date)} {fmtWeek(r.date)}</b> · {r.text}</span>
            {!print && <button className="btn" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => h.toggleRemind(r.key)}>{done ? '↩ 撤销' : '✓ 完成'}</button>}
          </div>
        );
      })}
      <h2 className="section">📮 自定义提醒 <span className="tip">针对本行程的备忘</span></h2>
      <div>
        {custom.length ? custom.map(r => {
          const done = t.remindDone['c_' + r.id];
          return (
            <div className={`remind-item ${done ? 'done' : ''}`} key={r.id}>
              <span className="when">{r.label}</span>
              <span className="txt"><b>{r.date}</b> · {r.text}</span>
              {!print && <><button className="btn" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={() => h.toggleRemind('c_' + r.id)}>{done ? '↩ 撤销' : '✓ 完成'}</button>
              <button className="btn danger" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => h.delCustom(r.id)}>🗑</button></>}
            </div>
          );
        }) : <div className="empty">暂无自定义提醒</div>}
      </div>
      {!print && <button className="btn pri" onClick={h.openCustomRemind}>＋ 添加提醒</button>}
    </div>
  );
}

function PrintDoc({ t, onClose }) {
  useEffect(() => {
    const tmr = setTimeout(() => window.print(), 1800);
    const h = () => onClose();
    window.addEventListener('afterprint', h);
    return () => { clearTimeout(tmr); window.removeEventListener('afterprint', h); };
  }, [onClose]);
  const nodeCount = t.plan.reduce((s, d) => s + d.nodes.length, 0);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return (
    <div className="doc">
      <div className="doc-head">
        <div className="doc-brand">🧭 旅途 · 旅行行程计划书</div>
        <div className="doc-meta">{t.emoji ? t.emoji + ' ' : ''}{t.name} · {t.destination} · {t.days} 天 {t.nights} 晚 · 共 {nodeCount} 个节点 · 生成于 {dateStr}</div>
      </div>
      <section className="doc-sec"><h2 className="doc-h2">一、行程概览</h2><Overview t={t} h={H0} print /></section>
      <section className="doc-sec"><h2 className="doc-h2">二、每日行程</h2><Itinerary t={t} h={H0} print /></section>
      <section className="doc-sec"><h2 className="doc-h2">三、交通与住宿</h2><Transport t={t} h={H0} print /></section>
      <section className="doc-sec"><h2 className="doc-h2">四、行李清单</h2><Packing t={t} h={H0} print /></section>
      <section className="doc-sec"><h2 className="doc-h2">五、行前提醒</h2>{t.startDate
        ? <Remind t={t} h={H0} print />
        : <div className="empty">出行日期待定。确定出发日期后，系统会自动生成 D-7 / D-3 / D-1 / D0 行前提醒。</div>}</section>
    </div>
  );
}

function EmptyState({ onNew, onImport }) {
  return (
    <div className="tab-panel"><div className="empty-state">
      <div className="empty-ico">🧳</div>
      <h2>还没有行程</h2>
      <p>创建你的第一个旅行计划，开始安排交通、住宿与每日行程；<br />也可以导入之前的 ZIP / JSON 备份继续编辑。</p>
      <div className="empty-ops">
        <button className="btn pri" onClick={onNew}>＋ 创建行程</button>
        <button className="btn" onClick={onImport}>导入备份</button>
      </div>
    </div></div>
  );
}

/* ─────────── 主组件 ─────────── */
export default function App() {
  const tripsRef = useRef(loadTrips());
  const activeRef = useRef(localStorage.getItem(LS_ACTIVE) || (tripsRef.current[0] && tripsRef.current[0].id) || null);
  const [, force] = useReducer(x => x + 1, 0);
  const [curTab, setCurTab] = useState('overview');
  const [theme, setTheme] = useState(localStorage.getItem(LS_THEME) || '');
  const [modal, setModal] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [printTrip, setPrintTrip] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef(null);
  const importRef = useRef(null);
  const mainRef = useRef(null);

  const getTrip = () => tripsRef.current.find(t => t.id === activeRef.current) || tripsRef.current[0] || null;

  const toast = useCallback(msg => {
    setToastMsg(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  }, []);

  const save = useCallback(() => { saveTrips(tripsRef.current, toast); force(); }, [toast]);
  const setActiveId = useCallback(id => {
    activeRef.current = id;
    if (id) localStorage.setItem(LS_ACTIVE, id); else localStorage.removeItem(LS_ACTIVE);
    force();
  }, []);

  useLayoutEffect(() => {
    if (theme) document.body.dataset.theme = theme; else delete document.body.dataset.theme;
  }, [theme]);

  /* 拖拽后抑制卡片点击 */
  useEffect(() => {
    const stop = e => { if (window.__justDragged) { e.stopPropagation(); e.preventDefault(); window.__justDragged = false; } };
    document.addEventListener('click', stop, true);
    return () => document.removeEventListener('click', stop, true);
  }, []);

  /* 全局粘贴自动识别 TPF v1 */
  useEffect(() => {
    const onPaste = e => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (!text) return;
      if (!/^\s*旅途行程\s*v1\s*$/mi.test(text)) return;
      const parsed = parseTripPaste(text);
      if (parsed.error) return toast(parsed.error);
      importPastedTrip(parsed.trip);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => { checkDueReminders(); }, []);

  /* 顶栏「更多」菜单外部关闭 */
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = e => { if (!e.target.closest('.menu-wrap')) setMenuOpen(false); };
    const onScroll = () => setMenuOpen(false);
    document.addEventListener('click', onDoc);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('click', onDoc); window.removeEventListener('scroll', onScroll, true); };
  }, [menuOpen]);

  function checkDueReminders() {
    const t = getTrip();
    if (!t || !t.startDate || !('Notification' in window) || Notification.permission !== 'granted') return;
    const today = new Date().toISOString().slice(0, 10);
    buildReminders(t).forEach(r => {
      if (r.date.toISOString().slice(0, 10) === today && !t.remindDone[r.key]) new Notification(`旅途提醒 · ${t.name}`, { body: r.text });
    });
  }

  function importPastedTrip(p) {
    normalizeTrip(p);
    tripsRef.current.push(p);
    activeRef.current = p.id;
    localStorage.setItem(LS_ACTIVE, p.id);
    save();
    toast(`✅ 已识别粘贴内容并创建行程「${p.name}」（${p.days} 天 ${p.plan.reduce((s, d) => s + d.nodes.length, 0)} 节点）`);
  }

  /* ── 行程级操作 ── */
  const reorderPlan = ids => {
    const t = getTrip(); if (!t) return;
    const byId = {}; t.plan.forEach(d => byId[d.id] = d);
    const newPlan = ids.map(id => byId[id]).filter(Boolean);
    if (newPlan.length !== t.plan.length) { toast('顺序更新失败'); return; }
    t.plan = newPlan; t.plan.forEach((d, i) => { d.day = i + 1; }); t.days = t.plan.length;
    save(); toast('行程顺序已更新');
  };
  const onHandleDown = (e, cardEl) => startOverviewDrag(e, cardEl, reorderPlan);
  const moveNodeToDay = (srcDay, nodeId, targetDay) => {
    const t = getTrip(); if (!t) return;
    if (targetDay == null) { const d = t.plan.find(x => x.day === srcDay); if (d) d.nodes.sort((a, b) => (a.time || '').localeCompare(b.time || '')); save(); return; }
    const s = t.plan.find(x => x.day === srcDay); const d = t.plan.find(x => x.day === targetDay);
    if (!s || !d) return;
    const idx = s.nodes.findIndex(n => n.id === nodeId); if (idx < 0) return;
    const [node] = s.nodes.splice(idx, 1); d.nodes.push(node); d.nodes.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    save(); toast(`已将「${node.title || '节点'}」移动到 Day ${targetDay}，并按时间排序`);
  };
  const onNodeGripDown = (e, nodeEl) => startNodeDrag(e, nodeEl, moveNodeToDay);
  const editDayTitle = (day, title) => { const t = getTrip(); const d = t.plan.find(x => x.day === day); if (d) { d.title = title.trim() || d.title; save(); toast('已保存'); } };
  const setDayCity = (day, val) => {
    const t = getTrip(); const d = t.plan.find(x => x.day === day); if (!d) return;
    const v = (val || '').trim(); d.city = v; save();
    toast(v ? `Day ${day} 所在城市已设为 ${v}` : `Day ${day} 城市已清空（将沿用前一日）`);
  };
  const delNode = (day, nodeId) => { const t = getTrip(); const d = t.plan.find(x => x.day === day); d.nodes = d.nodes.filter(n => n.id !== nodeId); save(); };
  const addDay = () => {
    const t = getTrip(); const next = t.plan.reduce((m, d) => Math.max(m, d.day), 0) + 1;
    t.plan.push({ id: uid(), day: next, title: `第 ${next} 天`, nodes: [], city: '' });
    t.days = t.plan.length; t.nights = Math.max(0, (t.nights || 0) + 1); save(); toast(`已增加第 ${next} 天`);
  };
  const removeDay = day => {
    const t = getTrip(); if (t.plan.length <= 1) return toast('至少保留 1 天');
    if (!window.confirm(`确定删除 Day ${day}？该天的所有行程节点也会一并删除。`)) return;
    t.plan = t.plan.filter(x => x.day !== day); t.plan.forEach((d, i) => { d.day = i + 1; });
    t.days = t.plan.length; t.nights = Math.max(0, (t.nights || 1) - 1); save(); toast(`已删除 Day ${day}`);
  };
  const addDayAndEdit = () => {
    const t = getTrip(); const n = t.plan.length + 1; addDay(); setCurTab('itinerary');
    requestAnimationFrame(() => {
      const blocks = mainRef.current ? mainRef.current.querySelectorAll('.day-block') : [];
      if (blocks.length) { const last = blocks[blocks.length - 1]; last.scrollIntoView({ behavior: 'smooth', block: 'center' }); last.classList.add('flash'); setTimeout(() => last.classList.remove('flash'), 1200); }
    });
    toast(`已新增 Day ${n}，在「每日行程」中编辑吧`);
  };
  const toggleTicket = id => { const t = getTrip(); const x = t.transport.find(i => i.id === id); x.booked = !x.booked; save(); };
  const toggleLodge = id => { const t = getTrip(); const x = t.lodging.find(i => i.id === id); x.booked = !x.booked; save(); };
  const markAllBooked = kind => {
    const t = getTrip(); const label = kind === 'transport' ? '车票/机票' : '住宿';
    if (!t[kind].length) return toast('还没有添加' + label);
    const all = t[kind].every(x => x.booked); t[kind].forEach(x => x.booked = !all); save();
    toast(all ? '已取消全部' + label + '的标记' : '已将全部' + label + '标记为已订');
  };
  const delItem = (kind, id) => { const t = getTrip(); t[kind] = t[kind].filter(i => i.id !== id); save(); };
  const toggleItem = (ci, id) => { const t = getTrip(); const i = t.packing[ci].items.find(x => x.id === id); i.done = !i.done; save(); };
  const delItemPack = (ci, id) => { const t = getTrip(); const c = t.packing[ci]; c.items = c.items.filter(x => x.id !== id); save(); };
  const toggleRemind = key => { const t = getTrip(); t.remindDone = t.remindDone || {}; t.remindDone[key] = !t.remindDone[key]; save(); };
  const delCustom = id => { const t = getTrip(); t.customReminds = (t.customReminds || []).filter(r => r.id !== id); save(); };
  const askNotify = () => {
    if (!('Notification' in window)) return toast('当前浏览器不支持通知');
    Notification.requestPermission().then(p => toast(p === 'granted' ? '通知已开启，行程日当天会提醒你' : '通知权限未开启'));
  };
  const goTab = name => { setCurTab(name); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  /* ── 弹窗打开 ── */
  const openNewTrip = () => setModal({ kind: 'newTrip' });
  const openDatePicker = () => setModal({ kind: 'date' });
  const openClearDate = () => setModal({ kind: 'clearDate' });
  const openNodeModal = (day, nodeId) => setModal({ kind: 'node', day, nodeId });
  const openTicketModal = id => setModal({ kind: 'ticket', id });
  const openLodgeModal = id => setModal({ kind: 'lodge', id });
  const openItemModal = () => setModal({ kind: 'item' });
  const openCustomRemind = () => setModal({ kind: 'customRemind' });
  const openEditDest = () => setModal({ kind: 'editDest' });
  const openTheme = () => setModal({ kind: 'theme' });
  const deleteTripPrompt = () => setModal({ kind: 'deleteTrip' });
  const generatePdf = () => { const tp = getTrip(); if (!tp) return toast('请先创建行程'); setPrintTrip(tp); };

  /* ── 创建 / 删除 / 导入 / 导出 ── */
  const createTrip = data => {
    const days = Math.max(1, +data.days || 1);
    const t = {
      id: uid(), name: data.name.trim() || '未命名行程', destination: data.dest.trim() || (data.name.trim() || '未命名行程'),
      emoji: data.emoji || '', days, nights: Math.max(0, +data.nights || 0), startDate: null, transport: [], lodging: [],
      plan: Array.from({ length: days }, (_, i) => ({ day: i + 1, title: `第 ${i + 1} 天`, nodes: [] })),
      packing: [
        { cat: '证件资金', items: [{ id: uid(), name: '身份证', qty: '每人', done: false }] },
        { cat: `衣物（按 ${days} 天配置）`, items: [{ id: uid(), name: '换洗内衣袜子', qty: `${days} 套`, done: false }] },
        { cat: '电子设备', items: [{ id: uid(), name: '手机充电器', qty: '1', done: false }] },
        { cat: '洗漱护肤', items: [{ id: uid(), name: '牙刷牙膏（旅行装）', qty: '1 套', done: false }] },
        { cat: '药品健康', items: [{ id: uid(), name: '常用药品', qty: '1 盒', done: false }] },
        { cat: '购买旅行保险', items: [
          { id: uid(), name: '旅行意外险', qty: '1 份', done: false },
          { id: uid(), name: '医疗救援险', qty: '1 份', done: false },
          { id: uid(), name: '航班/行李延误险', qty: '1 份', done: false }
        ] }
      ],
      remindDone: {}
    };
    normalizeTrip(t);
    tripsRef.current.push(t); activeRef.current = t.id;
    localStorage.setItem(LS_ACTIVE, t.id); save(); setModal(null); setCurTab('overview'); toast('行程已创建');
  };
  const doDeleteTrip = () => {
    const t = getTrip(); if (!t) return;
    const idx = tripsRef.current.findIndex(x => x.id === t.id); if (idx < 0) return;
    const name = t.name;
    tripsRef.current.splice(idx, 1);
    activeRef.current = tripsRef.current[0] ? tripsRef.current[0].id : null;
    if (activeRef.current) localStorage.setItem(LS_ACTIVE, activeRef.current); else localStorage.removeItem(LS_ACTIVE);
    save();
    toast(tripsRef.current.length ? `已删除行程「${name}」` : `已删除「${name}」，当前没有任何行程`);
  };
  const backupDelete = async () => {
    const t = getTrip(); if (!t) return;
    const { blob, imgCount } = await buildTripZip([t]);
    triggerDownload(blob, `旅途备份-${safeFileName(t.name)}-${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`已导出「${t.name}」备份（含 ${imgCount} 张图片），正在删除…`);
    doDeleteTrip();
  };
  const exportZip = async () => {
    const { blob, imgCount } = await buildTripZip(tripsRef.current);
    triggerDownload(blob, `旅途备份-${new Date().toISOString().slice(0, 10)}.zip`);
    toast(`已导出 ZIP 备份（含 ${imgCount} 张图片）`);
  };
  const onImportFile = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      let loaded;
      if (/\.zip$/i.test(f.name)) {
        const parts = await unzipFiles(f);
        const jsonPart = parts.find(x => /trip\.json$/i.test(x.name));
        if (!jsonPart) throw 0;
        loaded = JSON.parse(new TextDecoder().decode(jsonPart.data));
        const imgBytes = {};
        parts.forEach(x => { if (/^images\//i.test(x.name)) imgBytes[x.name.toLowerCase()] = x.data; });
        loaded.forEach(tp => tp.plan.forEach(d => d.nodes.forEach(nd => {
          if (nd.images) nd.images = nd.images.map(im => {
            const key = Object.keys(imgBytes).find(k => k.startsWith('images/' + String(im.id).toLowerCase() + '.'));
            const b = key ? imgBytes[key] : null;
            return { id: im.id, name: im.name, data: b ? bytesToDataURI(b, im.name) : '' };
          });
        })));
      } else {
        loaded = JSON.parse(await f.text());
      }
      if (!Array.isArray(loaded)) throw 0;
      loaded.forEach(normalizeTrip);
      tripsRef.current = loaded;
      activeRef.current = loaded[0] && loaded[0].id;
      if (activeRef.current) localStorage.setItem(LS_ACTIVE, activeRef.current); else localStorage.removeItem(LS_ACTIVE);
      save(); toast('导入成功');
    } catch (err) { toast('文件格式不正确，导入失败'); }
    e.target.value = '';
  };
  const copySkill = async () => {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    const txt = `请帮我安装一个 skill：下载 ${base}skills/travel-guide-paste-format/ 目录下的 SKILL.md、template.txt、example.txt 三个文件，按 SKILL.md 的 frontmatter 保存为本地 skill（目录名 travel-guide-paste-format）。安装后，当我让你生成旅游攻略、旅行计划或行程安排时，请按其中「旅途行程 v1（TPF v1）」粘贴格式输出，我要把它粘贴进「旅途」App 自动生成行程。`;
    let ok = false;
    try { await navigator.clipboard.writeText(txt); ok = true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
    }
    toast(ok ? '已复制 skill 安装指令，粘贴给任意智能体即可安装' : '复制失败，请手动选择页脚文字复制');
  };

  const h = {
    save, toast, goTab, openEditDest, openDatePicker, openClearDate, addDayAndEdit, onHandleDown,
    reorderPlan, openNodeModal, addDay, removeDay, editDayTitle, setDayCity, onNodeGripDown, moveNodeToDay,
    delNode, openTicketModal, openLodgeModal, markAllBooked, toggleTicket, toggleLodge, delItem, openItemModal,
    toggleItem, delItemPack, openCustomRemind, toggleRemind, delCustom, askNotify, openLightbox: setLightbox
  };

  const t = getTrip();

  const renderModal = () => {
    // 注意：newTrip 模态必须能在空状态（无当前行程 t）下打开，故仅在需要 t 的模态里各自兜底
    if (!modal || (!t && modal.kind !== 'newTrip')) return null;
    switch (modal.kind) {
      case 'newTrip': return <NewTripModal onCreate={createTrip} onClose={() => setModal(null)} />;
      case 'date': return <DatePickerModal t={t} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'clearDate': return <ConfirmClearDateModal t={t} save={save} onClose={() => setModal(null)} />;
      case 'node': return <NodeModal t={t} day={modal.day} nodeId={modal.nodeId} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'ticket': return <TicketModal t={t} id={modal.id} save={save} onClose={() => setModal(null)} />;
      case 'lodge': return <LodgeModal t={t} id={modal.id} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'item': return <ItemModal t={t} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'customRemind': return <CustomRemindModal t={t} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'editDest': return <EditDestModal t={t} save={save} onClose={() => setModal(null)} toast={toast} />;
      case 'deleteTrip': return <DeleteTripModal t={t} onlyOne={tripsRef.current.length <= 1}
        onDelete={() => { setModal(null); doDeleteTrip(); }}
        onBackupDelete={async () => { setModal(null); await backupDelete(); }} onClose={() => setModal(null)} />;
      case 'theme': return <ThemeModal cur={theme}
        onPick={id => { setTheme(id); localStorage.setItem(LS_THEME, id); toast('配色已切换并保存'); }}
        onClose={() => setModal(null)} />;
      default: return null;
    }
  };

  const TABS = [['overview', '总览'], ['itinerary', '每日行程'], ['transport', '交通住宿'], ['packing', '行李清单'], ['remind', '提醒']];

  return (
    <>
      <div className="topbar">
        <div className="brand">🧭 旅途 <span className="sub">旅游行程规划</span></div>
        <select id="tripSelect" value={activeRef.current || ''} onChange={e => setActiveId(e.target.value)}>
          {tripsRef.current.map(tr => <option key={tr.id} value={tr.id}>{tr.emoji ? tr.emoji + ' ' : ''}{tr.name}</option>)}
          {!tripsRef.current.length && <option value="">（暂无行程）</option>}
        </select>
        <div className="topbar-actions">
          <button className="btn pri" onClick={openNewTrip}>＋ 新建行程</button>
          <button className="btn" onClick={() => importRef.current && importRef.current.click()}>导入备份</button>
          <button className="btn" onClick={openTheme}>🎨 配色</button>
          <div className="menu-wrap">
            <button className="btn" aria-expanded={menuOpen} onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}>⋯ 更多</button>
            {menuOpen && <div className="menu-pop">
              <button className="menu-item" onClick={() => { setMenuOpen(false); exportZip(); }}>📦 导出 ZIP 备份</button>
              <button className="menu-item" onClick={() => { setMenuOpen(false); generatePdf(); }}>📄 生成 PDF</button>
              <button className="menu-item danger" onClick={() => { setMenuOpen(false); deleteTripPrompt(); }}>🗑 删除当前行程</button>
            </div>}
          </div>
          <input id="importFile" ref={importRef} type="file" accept=".zip,.json" style={{ display: 'none' }} onChange={onImportFile} />
        </div>
      </div>

      <div className="tabs" style={{ visibility: tripsRef.current.length ? 'visible' : 'hidden' }}>
        {TABS.map(([k, label]) => (
          <button key={k} data-tab={k} className={curTab === k ? 'active' : ''} onClick={() => setCurTab(k)}>{label}</button>
        ))}
      </div>

      <main ref={mainRef}>
        {!t ? <EmptyState onNew={openNewTrip} onImport={() => importRef.current && importRef.current.click()} />
          : curTab === 'overview' ? <Overview t={t} h={h} />
          : curTab === 'itinerary' ? <Itinerary t={t} h={h} />
          : curTab === 'transport' ? <Transport t={t} h={h} />
          : curTab === 'packing' ? <Packing t={t} h={h} />
          : <Remind t={t} h={h} />}
      </main>

      <footer className="site-foot">
        <div className="foot-inner">
          <div className="foot-skill">
            <div className="foot-title">🤖 用 AI 一键生成行程</div>
            <p>把这份 <b>skill</b> 装进任意智能体（下载下面三个文件，按 SKILL.md 的 frontmatter 存为本地 skill），之后让它生成旅游攻略时就会按 <b>「旅途行程 v1（TPF v1）」</b> 粘贴格式输出，你直接 <b>复制粘贴</b> 进来即可自动生成行程。</p>
            <div className="foot-ops">
              <a className="btn" href="skills/travel-guide-paste-format/SKILL.md">SKILL.md</a>
              <a className="btn" href="skills/travel-guide-paste-format/template.txt">template.txt</a>
              <a className="btn" href="skills/travel-guide-paste-format/example.txt">example.txt</a>
              <button className="btn pri" onClick={copySkill}>复制 skill 安装指令</button>
            </div>
            <div className="foot-note">提示：在任意页面直接粘贴符合 TPF v1 格式的行程块，也会自动识别并创建行程。</div>
          </div>
        </div>
      </footer>

      {lightbox && <div className="lb-mask" onClick={() => setLightbox(null)}>
        <img className="lb-img" src={lightbox} alt="" />
        <button className="lb-close" onClick={() => setLightbox(null)}>✕</button>
      </div>}

      {modal && renderModal()}

      {createPortal(
        <div id="printRoot">
          {printTrip && <PrintDoc t={printTrip} onClose={() => setPrintTrip(null)} />}
        </div>,
        document.body
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </>
  );
}
