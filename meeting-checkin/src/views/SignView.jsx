import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/cloud.js';
import { fmt, isPhone, qrSvg } from '../lib/util.js';
import { toast } from '../lib/toast.js';
import { useSignaturePad } from '../hooks.js';

export default function SignView() {
  const { mid } = useParams();
  const [status, setStatus] = useState('loading');
  const [err, setErr] = useState('');
  const [m, setM] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { msg, qrHtml }

  const boardRef = useRef(null);
  const board = useSignaturePad(boardRef, status === 'ready' && !!(m && m.h));

  useEffect(() => {
    let alive = true;
    api('/checkin/meeting/' + mid)
      .then(r => { if (alive) { setM(r); setStatus('ready'); } })
      .catch(e => { if (alive) { setStatus('error'); setErr(e.message); } });
    return () => { alive = false; };
  }, [mid]);

  const submit = async () => {
    if (busy) return;
    const n = name.trim();
    const p = phone.trim();
    if (!n) return toast('请填写姓名');
    if (!isPhone(p)) return toast('请填写正确的11位手机号');
    let sig = null;
    if (m.h) {
      if (!board.hasInk()) return toast('请在签名区手写签名');
      sig = board.data();
    }
    setBusy(true);
    try {
      const r = await api('/checkin/sign/' + mid, { method: 'POST', body: JSON.stringify({ n, p: p, sig, src: 'self' }) });
      const rec = r.existed ? r.record : { n, p, t: Date.now() };
      setDone({
        msg: `${rec.n}，${fmt(rec.t)}${r.existed ? '，你已签到过，请勿重复提交' : ' 签到成功'}${m.h ? '，签名已保存' : ''}`,
        qrHtml: qrSvg(`R|${rec.n}|${rec.p}|${rec.t}`, 160),
      });
    } catch (e) {
      toast(e.message || '签到失败');
      setBusy(false);
    }
  };

  const again = () => {
    setDone(null);
    setName('');
    setPhone('');
    board.clear();
    setBusy(false);
  };

  if (status === 'loading') {
    return (
      <div className="wrap">
        <div className="card"><p className="sub" style={{ textAlign: 'center', padding: 20 }}>加载会议中…</p></div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="wrap">
        <div className="card center">
          <div className="success-ico">⚠️</div>
          <h1>会议不存在或已删除</h1>
          <p className="sub">{err}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>签到 · {m.t}</h1>
        {m.i ? <p className="sub">{m.i}</p> : null}
        {m.a && m.a.length ? (
          <details>
            <summary>查看议程（{m.a.length}项）</summary>
            {m.a.map((s, idx) => (
              <div className="agenda-item" key={idx}><span className="idx">{idx + 1}</span><span>{s}</span></div>
            ))}
          </details>
        ) : null}
      </div>

      <div className="card" style={{ display: done ? 'none' : 'block' }}>
        <label className="label">姓名 *</label>
        <input type="text" maxLength={20} placeholder="请输入真实姓名" value={name} onChange={e => setName(e.target.value)} />
        <label className="label">手机号 *</label>
        <input type="text" maxLength={11} inputMode="numeric" placeholder="用于查重与联系，仅主办方可见" value={phone} onChange={e => setPhone(e.target.value)} />
        {m.h ? (
          <>
            <label className="label">手写签名 *</label>
            <canvas className="board" id="s-board" ref={boardRef}></canvas>
            <button className="btn plain sm" style={{ marginTop: 8 }} onClick={board.clear}>重写</button>
          </>
        ) : null}
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '提交中…' : '确认签到'}</button>
        <p className="scannote">提交即代表确认本人到场签到（数据实时同步到云端）</p>
      </div>

      {done ? (
        <div className="card">
          <div className="center">
            <div className="success-ico">✅</div>
            <h1>签到成功</h1>
            <p className="sub">{done.msg}</p>
            <div id="doneqr" style={{ padding: 10 }} dangerouslySetInnerHTML={{ __html: done.qrHtml }}></div>
            <p className="scannote">如现场工作人员需要核对，可出示此签到码（云端已同步，通常无需扫描）</p>
            <button className="btn plain sm" style={{ marginTop: 6 }} onClick={again}>返回签到页</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
