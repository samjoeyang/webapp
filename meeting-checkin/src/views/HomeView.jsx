import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api, adminHeaders, isUnlocked, signUrlOf, getShares, addShare, removeShare, deleteMeeting } from '../lib/cloud.js';
import { useMe, loginUrl } from '../../../src/session.js';
import { esc, fmt, fmtDT, copy, qrSvg, addToCalendar } from '../lib/util.js';
import { toast } from '../lib/toast.js';
import { startScan } from '../lib/scan.js';
import { removeMine } from '../lib/storage.js';
import { useGo, useBack } from '../hooks.js';
import Footer from '../components/Footer.jsx';
import AppHeader from '../components/AppHeader.jsx';
import EditView from './EditView.jsx';

export default function HomeView() {
  const { mid } = useParams();
  const go = useGo();
  const back = useBack();

  const [status, setStatus] = useState('loading');
  const [err, setErr] = useState('');
  const [m, setM] = useState(null);
  const [signs, setSigns] = useState([]);
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scanErr, setScanErr] = useState(null); // 相机启动失败原因
  const [scanKey, setScanKey] = useState(0);    // 递增触发重新开启相机
  const [showAdmin, setShowAdmin] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [shares, setShares] = useState([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const me = useMe(); // 已登录用户按创建者/共享邮箱授权（共享订阅，状态稳定）

  const videoRef = useRef(null);
  const stopRef = useRef(null);
  const lockedRef = useRef(false);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  const stopScan = () => {
    if (stopRef.current) { stopRef.current(); stopRef.current = null; }
  };
  useEffect(() => () => stopScan(), []);

  const load = async () => {
    setStatus('loading');
    let mm;
    try { mm = await api('/checkin/meeting/' + mid); }
    catch (e) { setStatus('error'); setErr(e.message); return; }
    // 后端按创建者/共享邮箱判定权限；口令解锁存于前端 sessionStorage
    const authorized = !!(mm.canManage || isUnlocked(mid));
    const needsPass = !!mm.hasPass && !authorized;
    let sg = [];
    let lk = false;
    if (needsPass) lk = true;
    else {
      try { const r = await api('/checkin/sign/' + mid, { headers: adminHeaders(mid) }); sg = r.data; }
      catch (e) {
        if (e.status === 403) lk = true;
        else { setStatus('error'); setErr(e.message); return; }
      }
    }
    setM(mm); setSigns(sg); setLocked(lk); setStatus('ready');
  };

  // me 就绪/变化后重拉一次：后端按 cookie 判权，登录态切换需刷新 canManage
  useEffect(() => { if (!editing) load(); /* eslint-disable-next-line */ }, [mid, editing, me?.sub]);

  const unlock = (after) => {
    const pass = prompt('请输入管理口令');
    if (pass == null) return;
    api('/checkin/sign/' + mid, { headers: { 'x-admin-pass': pass } })
      .then(() => {
        sessionStorage.setItem('checkin_admin_' + mid, pass);
        toast('✅ 已解锁');
        after && after();
      })
      .catch(e => { if (e.status === 403) toast('口令错误'); else toast(e.message || '验证失败'); });
  };

  useEffect(() => {
    if (!showScan || !videoRef.current) return;
    stopScan();
    setScanErr(null);
    stopRef.current = startScan(
      videoRef.current,
      text => {
        if (text.startsWith('R|')) {
          const parts = text.split('|');
          const n = parts[1], p = parts[2], t = +parts[3];
          api('/checkin/sign/' + mid, { method: 'POST', body: JSON.stringify({ n, p, t, src: 'scan' }) })
            .then(r => {
              toast(r.existed ? ('已在名单中：' + n) : ('已收录：' + n));
              if (!lockedRef.current) setSigns(s => [...s, r.record]);
            })
            .catch(e => toast(e.message || '收录失败'));
        }
      },
      err => setScanErr(err) // err=null 表示启动成功
    );
    return () => stopScan();
  }, [showScan, scanKey]);

  if (editing && m) return <EditView mid={mid} onBack={() => { setEditing(false); load(); }} />;

  if (status === 'loading') {
    return (
      <div className="wrap home">
        <div className="card"><p className="sub" style={{ textAlign: 'center', padding: 20 }}>加载会议中…</p></div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="wrap home">
        <div className="card center">
          <div className="success-ico">⚠️</div>
          <h1>会议不存在或已删除</h1>
          <p className="sub">{err}</p>
          <button className="btn plain" onClick={() => go('#/create')}>返回首页</button>
        </div>
      </div>
    );
  }

  const signUrl = signUrlOf(mid);
  const del = async (id) => {
    if (!confirm('删除该签到记录？')) return;
    try {
      await api('/checkin/sign/' + mid + '/' + id, { method: 'DELETE', headers: adminHeaders(mid) });
      setSigns(s => s.filter(x => x._id !== id));
    } catch (e) { toast(e.status === 403 ? '口令错误' : (e.message || '删除失败')); }
  };

  const onExport = async () => {
    let rows = signs;
    if (locked || signs.length === 0) {
      try { const r = await api('/checkin/sign/' + mid, { headers: adminHeaders(mid) }); rows = r.data; }
      catch (e) { return toast(e.status === 403 ? '口令错误' : (e.message || '获取失败')); }
    }
    if (!rows.length) return toast('暂无签到记录');
    const withSig = rows.some(r => r.sig);
    const head = ['姓名', '手机号', '签到时间', '来源'];
    if (withSig) head.push('签名');
    const csv = '﻿' + head.join(',') + '\n' + rows.map(r => {
      const cells = [r.n, r.p, new Date(r.t).toLocaleString('zh-CN'), r.src === 'scan' ? '扫码收录' : '本机签到'];
      if (withSig) cells.push(r.sig ? '已签名（登录会议主页核对）' : '无');
      return cells.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',');
    }).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = m.t + '-签到名单.csv';
    a.click();
  };

  const onClear = async () => {
    if (!confirm('确定清空全部签到记录？此操作不可恢复。')) return;
    try {
      await api('/checkin/sign/' + mid, { method: 'DELETE', headers: adminHeaders(mid) });
      setSigns([]);
      toast('已清空');
    } catch (e) { toast(e.status === 403 ? '口令错误' : (e.message || '清空失败')); }
  };

  const onAdminBtn = () => {
    if (m.hasPass && !(m.canManage || isUnlocked(mid))) unlock(() => setShowAdmin(true));
    else setShowAdmin(v => !v);
  };

  // 共享名单仅创建者可管理；历史会议（无归属字段）对登录用户开放
  const canShare = !!(me && m && (!m.ownerSub && !m.ownerEmail ? true : m.viewerRole === 'owner'));

  const loadShares = async () => {
    try {
      const r = await getShares(mid);
      setShares(r.data || []);
      return true;
    } catch (e) {
      toast(e.message || '加载共享名单失败');
      return false;
    }
  };

  const toggleShare = async () => {
    if (showShare) { setShowShare(false); return; }
    if (!canShare) return toast('仅创建者可管理共享');
    if (await loadShares()) setShowShare(true);
  };

  const submitShare = async () => {
    const email = shareEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('请填写有效邮箱');
    if (shareBusy) return;
    setShareBusy(true);
    try {
      await addShare(mid, email);
      setShareEmail('');
      await loadShares();
      toast('已添加共享人');
    } catch (e) {
      toast(e.message || '添加失败');
    } finally { setShareBusy(false); }
  };

  const removeMeeting = async () => {
    if (!confirm('确定删除该会议？签到名单与共享设置将一并删除，且不可恢复。')) return;
    try {
      await deleteMeeting(mid);
      try { removeMine(mid); } catch (_) { /* ignore */ }
      toast('会议已删除');
      go('#/mine');
    } catch (e) { toast(e.message || '删除失败'); }
  };

  const dropShare = async (email) => {
    if (!confirm('移除该共享人的管理权限？')) return;
    try {
      await removeShare(mid, email);
      await loadShares();
      toast('已移除');
    } catch (e) { toast(e.message || '移除失败'); }
  };

  return (
    <div className="wrap home">
      <AppHeader me={me} onBack={back} action={{ label: '我的会议', onClick: () => go('#/mine') }} />
      <div className="card">
        <div className="home-hero">
          <div className="qr-col">
            <div id="qrbox" dangerouslySetInnerHTML={{ __html: qrSvg(signUrl) }} />
            <p className="sub" style={{ marginTop: 2 }}>请使用微信/相机扫码签到{m.h ? '，签到需手写签名' : ''}</p>
            <button className="btn plain sm" onClick={() => copy(signUrl)}>复制签到链接</button>
          </div>
          <div className="info-col">
            <h1 className="hero-title">{m.t}<span className="tag">签到中</span></h1>
            {m.o ? <p className="sub">发起人：{m.o} · 创建于 {fmt(m.c)}</p> : null}
            {m.tm ? <p className="sub" style={{ marginTop: 6 }}>📅 {fmtDT(m.tm)}</p> : null}
            {m.pl ? <p className="sub">📍 {m.pl}</p> : null}
            {m.tm ? <button className="btn plain sm" style={{ marginTop: 10 }} onClick={() => addToCalendar(mid)}>📅 加入日历</button> : null}
            {m.i ? <p className="sub" style={{ marginTop: 8 }}>{m.i}</p> : null}
            {m.a && m.a.length ? (
              <>
                <h2 style={{ marginTop: 14 }}>议程</h2>
                {m.a.map((s, idx) => (
                  <div className="agenda-item" key={idx}><span className="idx">{idx + 1}</span><span>{s}</span></div>
                ))}
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="card">
        <h2>签到名单 <span className="tag">{signs.length} 人</span></h2>
        {locked ? (
          <div className="lockbox">
            <p className="sub">该会议已设管理口令，输入管理口令后可查看与管理名单。</p>
            {me === undefined ? (
              <p className="sub" style={{ marginTop: 6 }}>正在检测登录状态…</p>
            ) : me ? (
              <p className="sub" style={{ marginTop: 6 }}>
                你已登录为 <b>{esc(me.name || me.email || '当前账号')}</b>，但该账号暂无管理权限（可能不是创建者、或被共享邮箱不一致）。可
                <button type="button" className="linkbtn" onClick={() => load()}>刷新权限</button>，或联系创建者共享邮箱，也可直接输入管理口令。
              </p>
            ) : (
              <p className="sub" style={{ marginTop: 6 }}>也可 <a href={loginUrl(location.href)}>登录账号</a> 后免口令管理（创建者/被共享邮箱）。</p>
            )}
            <button className="btn blue sm" style={{ marginTop: 10 }} onClick={() => unlock(() => load())}>🔓 输入管理口令</button>
          </div>
        ) : (
          <div id="reclist">
            {signs.length ? signs.map((r) => (
              <div className="rec" key={r._id}>
                <div className="avatar">{(r.n || '?').slice(0, 1)}</div>
                <div className="info">
                  <div className="nm">{r.n}</div>
                  <div className="meta">{r.p} · {fmt(r.t)}{r.src === 'scan' ? ' · 扫码收录' : ''}</div>
                </div>
                <span className="del" onClick={() => del(r._id)}>删除</span>
              </div>
            )) : <p className="sub">暂无签到记录，扫码签到后这里会实时显示（云端同步）。</p>}
          </div>
        )}
      </div>
      <div className="card">
        <div className="row" style={{ gap: 10 }}>
          <button className="btn blue sm" style={{ flex: 1 }} onClick={() => { if (showScan) { stopScan(); setShowScan(false); } else setShowScan(true); }}>📷 扫码收录签到</button>
          <button className="btn plain sm" style={{ flex: 1 }} onClick={onAdminBtn}>⚙️ 管理会议</button>
        </div>
        {showScan ? (
          <div id="scanarea" style={{ marginTop: 12 }}>
            <video id="scanvideo" ref={videoRef} style={scanErr ? { display: 'none' } : undefined}></video>
            {scanErr ? (
              <div className="scanerr" role="alert">
                <b>{scanErr.title}</b>
                <p>{scanErr.detail}</p>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn blue sm" onClick={() => setScanKey(k => k + 1)}>重试相机</button>
                  <button className="btn plain sm" onClick={() => { stopScan(); setShowScan(false); }}>关闭</button>
                </div>
              </div>
            ) : (
              <>
                <p className="scannote">对准参会人"签到成功"页上的签到码即可录入名单（云端同步）</p>
                <button className="btn plain sm" style={{ marginTop: 10 }} onClick={() => { stopScan(); setShowScan(false); }}>停止扫码</button>
              </>
            )}
          </div>
        ) : null}
        {showAdmin ? (
          <div id="adminarea" style={{ marginTop: 14 }}>
            <div className="divider"></div>
            <h2>会议管理</h2>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="btn blue sm" onClick={() => setEditing(true)}>修改会议设置</button>
              <button className="btn plain sm" onClick={onExport}>导出名单 CSV</button>
              <button className="btn danger sm" onClick={onClear}>清空签到名单</button>
              {canShare ? <button className="btn plain sm" onClick={toggleShare}>🔗 共享会议</button> : null}
              {m.viewerRole === 'owner' ? <button className="btn danger sm" onClick={removeMeeting}>删除会议</button> : null}
            </div>
            <p className="sub" style={{ marginTop: 10 }} dangerouslySetInnerHTML={{ __html: '身份：' + (m.viewerRole === 'owner' ? '创建者' : m.viewerRole === 'shared' ? '被共享的协管人' : me ? '已登录（' + esc(me.name || me.sub) + '）' : m.hasPass ? '口令管理员' : '开放管理') + '。' + (m.hasPass ? '本会议已设管理口令（出于安全不再公开展示）。' : '本会议未设管理口令，打开主页者可管理，建议创建者设置口令。') }}></p>
            {canShare ? (
              <div style={{ marginTop: 12 }}>
                <button className="btn plain sm" onClick={toggleShare}>{showShare ? '收起共享设置' : '🔗 共享给邮箱协管人'}</button>
                {showShare ? (
                  <div style={{ marginTop: 10 }}>
                    <p className="sub">添加邮箱后，对方用该邮箱对应账号登录，即可在「我的会议」看到并管理本会议。不会自动发送邮件，请自行告知。</p>
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <input type="email" style={{ flex: 1 }} placeholder="协管人邮箱，如 colleague@example.com" value={shareEmail} onChange={e => setShareEmail(e.target.value)} />
                      <button className="btn blue sm" onClick={submitShare} disabled={shareBusy}>{shareBusy ? '添加中…' : '添加共享'}</button>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      {shares.length ? shares.map(s => (
                        <div className="row" key={s.email} style={{ justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ fontSize: 14, overflowWrap: 'anywhere' }}>{s.email}</span>
                          <button className="btn plain sm" onClick={() => dropShare(s.email)}>移除</button>
                        </div>
                      )) : <p className="sub">暂无共享人。未设管理口令时打开主页者均可管理；设置口令后仅创建者/共享人可管理，建议设置口令。</p>}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Footer />
    </div>
  );
}
