/* 我的会议：localStorage（仅本机快捷入口，实际数据在云端） */
export function loadMine() {
  try { return JSON.parse(localStorage.getItem('checkin_mine') || '[]'); }
  catch (e) { return []; }
}

export function upsertMine(p) {
  const l = loadMine();
  const i = l.findIndex(x => x.id === p.id);
  // 保留首次创建时间 c，避免编辑会议后被覆盖成当前时间
  if (i >= 0) l[i] = { ...l[i], ...p, c: l[i].c || p.c || Date.now() };
  else l.unshift(p);
  localStorage.setItem('checkin_mine', JSON.stringify(l));
}

export function removeMine(id) {
  localStorage.setItem('checkin_mine', JSON.stringify(loadMine().filter(x => x.id !== id)));
}
