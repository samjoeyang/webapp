import { useState, useEffect } from 'react';
import { useGo, useBack } from '../hooks.js';
import { loadMine, removeMine } from '../lib/storage.js';
import { myMeetings } from '../lib/cloud.js';
import { useMe, loginUrl } from '../../../src/session.js';
import { fmtDT } from '../lib/util.js';
import { toast } from '../lib/toast.js';
import AppHeader from '../components/AppHeader.jsx';

const ROLE_TAG = {
  owner: '我创建的',
  shared: '共享给我',
  local: '仅本机',
};

export default function MineView() {
  const go = useGo();
  const back = useBack();
  const [list, setList] = useState([]);
  const me = useMe();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (me === undefined) return; // 登录态探测中，等 useMe 广播
    let alive = true;
    if (!me) {
      // 未登录：只展示本机快捷入口
      setList(loadMine().map(x => ({ ...x, role: 'local' })));
      return () => { alive = false; };
    }

    // 已登录：按账号从云端拉取（创建 + 被共享），并合并未绑定账号的本机记录
    setLoading(true);
    (async () => {
      try {
        const r = await myMeetings();
        if (!alive) return;
        const cloud = r.data || [];
        const cloudIds = new Set(cloud.map(x => x.id));
        const localOnly = loadMine()
          .filter(x => !cloudIds.has(x.id))
          .map(x => ({ ...x, role: 'local' }));
        setList([...cloud, ...localOnly]);
      } catch (e) {
        if (alive) {
          // 云端不可用时仍展示本机记录，避免登录后一片空白
          setList(loadMine().map(x => ({ ...x, role: 'local' })));
          toast((e.status === 404 ? '云端服务暂不可用' : (e.message || '云端会议加载失败')) + '，当前仅显示本机记录');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [me]);

  const del = (id) => {
    if (confirm('仅从本机移除该快捷入口（云端会议与签到数据不受影响）？')) {
      removeMine(id);
      setList(l => l.filter(x => x.id !== id));
    }
  };

  return (
    <div className="wrap">
      <AppHeader me={me} onBack={back} action={{ label: '创建', icon: 'plus', onClick: () => go('#/create') }} />
      <h1 style={{ margin: '4px 2px 8px' }}>我的会议</h1>
      {me ? (
        <p className="sub" style={{ marginBottom: 14 }}>已按账号从云端同步：你创建的会议，以及他人共享给你的会议，换设备登录同样可见。</p>
      ) : (
        <p className="sub" style={{ marginBottom: 14, color: 'var(--warn)' }}>
          <a href={loginUrl(location.href)}>登录</a> 后可跨设备查看你创建的会议、接收他人共享的会议；当前仅显示本机记录。
        </p>
      )}

      {loading ? (
        <div className="card"><p className="sub" style={{ textAlign: 'center', padding: 20 }}>加载云端会议中…</p></div>
      ) : list.length ? list.map(m => (
        <div className="card" key={m.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, overflowWrap: 'anywhere' }}>{m.t}</div>
              {m.tm ? <div className="sub">📅 {fmtDT(m.tm)}</div> : null}
              {m.pl ? <div className="sub">📍 {m.pl}</div> : null}
            </div>
            <span className="tag">{ROLE_TAG[m.role] || '云端'}</span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn blue sm" style={{ flex: 1 }} onClick={() => go('#/m/' + m.id)}>打开主页</button>
            {m.role === 'local' ? (
              <button className="btn plain sm" style={{ flex: 1 }} onClick={() => del(m.id)}>移除本机记录</button>
            ) : null}
          </div>
        </div>
      )) : (
        <div className="card"><p className="sub">{me ? '账号下还没有会议。创建会议后会出现在这里；他人共享给你的会议也会显示。' : '还没有本机会议记录。登录后可跨设备同步。'}</p></div>
      )}
    </div>
  );
}
