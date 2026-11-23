import { useState, useRef, useEffect } from 'react';
import { useGo } from '../hooks.js';
import { api } from '../lib/cloud.js';
import { useMe, loginUrl } from '../../../src/session.js';
import { upsertMine } from '../lib/storage.js';
import { parseMeetingInfo } from '../lib/parse.js';
import { toast } from '../lib/toast.js';
import AppHeader from '../components/AppHeader.jsx';
import Footer from '../components/Footer.jsx';

export default function CreateView() {
  const go = useGo();
  const cardRef = useRef(null);
  const [form, setForm] = useState({ title: '', time: '', place: '', intro: '', agenda: '', owner: '', pass: '', hand: false });
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const meName = (me && (me.name || me.login)) || '';

  // 创建人姓名默认取登录者姓名，用户可改；粘贴填会不覆盖已填内容
  useEffect(() => {
    if (meName) setForm(f => ({ ...f, owner: f.owner || meName }));
  }, [meName]);

  useEffect(() => {
    const onPaste = e => {
      const h = location.hash;
      if (h && h !== '#/' && h !== '#/create') return;
      const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
      const info = parseMeetingInfo(txt);
      if (!info) return;
      e.preventDefault();
      setForm(f => ({
        title: info.t || '',
        time: info.tm || '',
        place: info.pl || '',
        intro: info.i || '',
        agenda: (info.a || []).join('\n'),
        owner: f.owner,
        pass: info.p || '',
        hand: !!info.h,
      }));
      const card = cardRef.current;
      if (card) {
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1900);
      }
      toast('✅ 已识别会议信息并填充表单');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const submit = async () => {
    if (busy) return;
    if (!me) return toast('请先登录后再创建会议');
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
      o: form.owner.trim() || meName,
      p: pass,
      h: form.hand ? 1 : 0,
    };
    setBusy(true);
    try {
      const r = await api('/checkin/meeting', { method: 'POST', body: JSON.stringify(payload) });
      upsertMine({ id: r.id, t: title, tm: payload.tm, pl: payload.pl, c: Date.now() });
      go('#/m/' + r.id);
    } catch (e) {
      toast(e.message || '创建失败');
      setBusy(false);
    }
  };

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const setCheck = e => setForm(f => ({ ...f, hand: e.target.checked }));

  const header = <AppHeader me={me} action={{ label: '我的会议', onClick: () => go('#/mine') }} />;

  if (me === undefined) {
    return <div className="wrap">{header}<div className="card"><p className="sub" style={{ textAlign: 'center', padding: 20 }}>正在检测登录状态…</p></div></div>;
  }

  if (!me) {
    return (
      <div className="wrap">
        {header}
        <div className="card center">
          <div className="success-ico">🔒</div>
          <h1>请先登录</h1>
          <p className="sub">创建会议必须先登录。会议会绑定到你的账号，登录后可在任意设备管理、并共享给协管人。</p>
          <a className="btn" href={loginUrl(location.href)}>登录并创建会议</a>
          <p className="sub" style={{ marginTop: 10 }}>已有会议需要签到？直接打开他人分享的签到链接即可，无需登录。</p>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="wrap">
      {header}
      <div className="card" ref={cardRef}>
        <h1>创建会议</h1>
        <p className="sub">创建后自动生成签到二维码，分享即可邀请参会。数据保存在云端，多设备实时同步。</p>
        <p className="sub" style={{ color: 'var(--blue)' }}>已登录（{me.name || me.sub}）：会议自动绑定到你的账号，可在「我的会议」跨设备管理并共享给他人。</p>
        <div className="pastezone">
          <div className="pz-h">🤖 AI 智能填会</div>
          <p className="sub">在智能体（如 WorkBuddy）中生成会议信息后，复制整段文本，<b>粘贴到本页任意位置</b>（或下方输入框），即可自动填充表单。</p>
          <textarea rows="2" placeholder="📋 点击此处，粘贴智能体生成的会议信息"></textarea>
          <p className="sub" style={{ marginTop: 6 }}>还没安装技能？见页面底部「安装 AI 填会技能」，复制提示语到智能体即可远程安装。</p>
        </div>
        <label className="label">会议名称 *</label>
        <input type="text" maxLength={40} placeholder="例如：产品月度评审会" value={form.title} onChange={set('title')} />
        <label className="label">会议时间</label>
        <input type="datetime-local" value={form.time} onChange={set('time')} />
        <label className="label">会议地点</label>
        <input type="text" maxLength={60} placeholder="例如：总部 3 楼会议室 / 腾讯会议 123456" value={form.place} onChange={set('place')} />
        <label className="label">会议简介（可选）</label>
        <textarea maxLength={300} placeholder="参会对象、注意事项等" value={form.intro} onChange={set('intro')} />
        <label className="label">议程（可选，一行一条）</label>
        <textarea placeholder={'14:00 开场介绍\n14:20 方案评审\n15:00 自由讨论'} value={form.agenda} onChange={set('agenda')} />
        <label className="label">创建人姓名</label>
        <input type="text" maxLength={20} placeholder="默认取你的登录姓名，可修改" value={form.owner} onChange={set('owner')} />
        <p className="sub" style={{ marginTop: 4 }}>默认显示你的登录姓名（{meName || '登录姓名'}），可按需修改。</p>
        <label className="label">管理口令（可选，4-8位数字 · 协管人凭证 · 用于跨设备管理）</label>
        <input type="text" maxLength={8} placeholder="留空则主页名单开放可见" value={form.pass} onChange={set('pass')} />
        <p className="sub" style={{ marginTop: 6 }}>设口令后，把口令告知协管人；对方在会议主页点"管理会议"输入口令即可修改会议信息、查看/管理名单（跨设备生效）。留空则主页名单对打开主页者开放。</p>
        <label className="check"><input type="checkbox" checked={form.hand} onChange={setCheck} /> 签到时需手写签名</label>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? '创建中…' : '创建会议'}</button>
      </div>
      <div className="card">
        <details>
          <summary>使用说明</summary>
          <p>① 创建后进入会议主页，页面上有<b>签到二维码</b>，用微信"扫一扫"即可进入签到页；也可复制链接分享。</p>
          <p>② 会议信息与签到名单保存在<b>云端</b>（复用本站后端存储），主持人在任何设备打开会议主页都能看到实时名单，参会人用手机签到后即时同步，无需"出示签到码"。</p>
          <p>③ 相机扫码要求 HTTPS 或 localhost 环境。</p>
          <p>④ 网页端拿不到微信身份，签到以"姓名+手机号"为准，同手机号自动查重防重复签到；将来嵌入小程序可直接升级为微信授权自动填充。</p>
          <p>⑤ 登录后创建：会议自动归入账号下的<b>「我的会议」</b>，换设备登录即可管理；在会议主页「共享会议」中按<b>邮箱</b>添加协管人，对方用该邮箱登录后即可共同管理。</p>
          <p>⑥ <b>AI 智能填会</b>：安装页面底部的「会议信息」技能后，把会议素材发给智能体，复制生成的格式文本，在本页任意位置粘贴即可自动填充本表单。</p>
        </details>
      </div>
      <Footer />
    </div>
  );
}
