import { useState, useEffect } from 'react';
import { api, adminHeaders } from '../lib/cloud.js';
import { upsertMine } from '../lib/storage.js';
import { toast } from '../lib/toast.js';
import { useMe } from '../../../src/session.js';
import AppHeader from '../components/AppHeader.jsx';

export default function EditView({ mid, onBack }) {
  const [m, setM] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState({ title: '', time: '', place: '', intro: '', agenda: '', pass: '', clearPass: false, hand: false });
  const [busy, setBusy] = useState(false);
  const me = useMe();

  useEffect(() => {
    let alive = true;
    api('/checkin/meeting/' + mid)
      .then(r => { if (alive) { setM(r); setForm({ title: r.t, time: r.tm || '', place: r.pl || '', intro: r.i || '', agenda: (r.a || []).join('\n'), pass: '', clearPass: false, hand: !!r.h }); } })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [mid]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setCheck = e => setForm(f => ({ ...f, hand: e.target.checked }));

  // 仅创建者（或持口令者）可改口令；被共享的协管人隐藏该字段，避免夺权
  const canPass = !m || m.viewerRole === 'owner' || !m.hasPass;

  const save = async () => {
    if (busy) return;
    const title = form.title.trim();
    if (!title) return toast('请填写会议名称');
    const pass = form.pass.trim();
    if (pass && !/^\d{4,8}$/.test(pass)) return toast('管理口令需为4-8位数字');
    const payload = {
      t: title,
      tm: form.time,
      pl: form.place.trim(),
      i: form.intro.trim(),
      a: form.agenda.split('\n').map(s => s.trim()).filter(Boolean),
      h: form.hand ? 1 : 0,
    };
    if (canPass && pass) payload.p = pass;
    else if (canPass && form.clearPass) payload.clearPass = true;
    setBusy(true);
    try {
      await api('/checkin/meeting/' + mid, { method: 'PUT', body: JSON.stringify(payload), headers: adminHeaders(mid) });
      // 不传 c：storage.upsertMine 会保留首次创建时间
      upsertMine({ id: mid, t: title, tm: payload.tm, pl: payload.pl });
      toast('已保存');
      onBack();
    } catch (e) {
      toast(e.status === 403 ? '无权修改（仅创建者或管理口令持有者可改口令）' : (e.message || '保存失败'));
      setBusy(false);
    }
  };

  if (err) {
    return (
      <div className="wrap">
        <AppHeader me={me} onBack={onBack} />
        <div className="card center">
          <div className="success-ico">⚠️</div>
          <h1>会议不存在</h1>
          <p className="sub">{err}</p>
          <button className="btn plain" onClick={onBack}>返回</button>
        </div>
      </div>
    );
  }
  if (!m) {
    return (
      <div className="wrap">
        <AppHeader me={me} onBack={onBack} />
        <div className="card"><p className="sub" style={{ textAlign: 'center', padding: 20 }}>加载会议设置中…</p></div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <AppHeader me={me} onBack={onBack} />
      <div className="card">
        <h1>修改会议设置</h1>
        <p className="sub" style={{ color: 'var(--warn)' }}>修改后即时生效，已分享的签到二维码保持不变（基于会议ID，跨设备同步）。</p>
        <label className="label">会议名称 *</label>
        <input type="text" maxLength={40} value={form.title} onChange={set('title')} />
        <label className="label">会议时间</label>
        <input type="datetime-local" value={form.time} onChange={set('time')} />
        <label className="label">会议地点</label>
        <input type="text" maxLength={60} value={form.place} onChange={set('place')} />
        <label className="label">会议简介</label>
        <textarea maxLength={300} value={form.intro} onChange={set('intro')} />
        <label className="label">议程（一行一条）</label>
        <textarea value={form.agenda} onChange={set('agenda')} />
        {canPass ? (
          <>
            <label className="label">管理口令（4-8位数字 · 留空保持不变）</label>
            <input type="text" maxLength={8} placeholder={m.hasPass ? '留空则保持原口令不变' : '留空则开放管理'} value={form.pass} onChange={set('pass')} disabled={form.clearPass} />
            {m.hasPass ? (
              <label className="check"><input type="checkbox" checked={form.clearPass} onChange={e => setForm(f => ({ ...f, clearPass: e.target.checked, pass: e.target.checked ? '' : f.pass }))} /> 清除管理口令（改为开放管理）</label>
            ) : null}
          </>
        ) : (
          <p className="sub" style={{ color: 'var(--warn)' }}>管理口令仅创建者可修改。你是被共享的协管人，可修改会议内容与名单，但不能改口令。</p>
        )}
        <label className="check"><input type="checkbox" checked={form.hand} onChange={setCheck} /> 签到时需手写签名</label>
        <button className="btn" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存修改'}</button>
      </div>
    </div>
  );
}
