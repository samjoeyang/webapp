import { useState, useEffect, useMemo, useRef, useLayoutEffect, useId } from 'react'
import { APPS, DESKTOP_APPS, SKILLS, APIS, API_BASE } from './data.js'
import { useMe, loginUrl, logoutUrl } from './session.js'

// 介绍文字：默认按行数折叠，只有真的溢出时才出现「展开 / 收起」
// 只作用于描述这一块，卡片其它区域（标题/标签/操作）不受影响
function Desc({ text, lines = 5 }) {
  const [open, setOpen] = useState(false)
  const [needToggle, setNeedToggle] = useState(false)
  const ref = useRef(null)
  const id = useId()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    const measure = () => setNeedToggle(el.scrollHeight - el.clientHeight > 2)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open, lines])

  return (
    <>
      <div ref={ref} id={id} className={open ? 'desc' : 'desc clamp'}
        style={open ? undefined : { WebkitLineClamp: lines }}>
        {text}
      </div>
      {needToggle && (
        <button type="button" className="more" aria-expanded={open} aria-controls={id}
          onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(v => !v) }}
          onKeyDown={e => e.stopPropagation()}>
          {open ? '收起' : '展开'}
        </button>
      )}
    </>
  )
}

function AppCard({ a }) {
  const cls = a.status === 'live' ? 'live' : a.status === 'open' ? 'open' : 'src'
  return (
    <div className="app">
      <div className="top">
        <div className="ico">{a.ico}</div>
        <h3>{a.name}</h3>
      </div>
      <Desc text={a.desc} lines={4} />
      <div className="meta">
        <span className={`badge ${cls}`}>{a.label}</span>
        {(a.platforms || []).map(p => <span key={p} className="badge plat">{p}</span>)}
      </div>
      <a className="go stretch" href={a.link} target="_blank" rel="noopener">
        {a.status === 'live' ? '访问 →' : a.status === 'desktop' ? '前往下载 →' : '打开 →'}
      </a>
    </div>
  )
}

function SkillCard({ s }) {
  const [done, setDone] = useState(false)
  const t = useRef(null)
  const url = s.url || new URL('skills/' + s.slug + '/SKILL.md', location.href).href
  const copy = () => {
    const prompt = `请安装这个 Skill：\n【名称】${s.name}\n【简介】${s.desc}\n【安装地址】${url}\n\n请从上述地址加载并安装该 Skill（保持目录结构完整）。`
    navigator.clipboard.writeText(prompt).then(() => {
      setDone(true)
      clearTimeout(t.current)
      t.current = setTimeout(() => setDone(false), 1800)
    }).catch(() => {
      // 复制失败提示（移动端等无 clipboard 权限时）
      if (navigator.clipboard) navigator.clipboard.writeText(url)
    })
  }
  const tags = (s.tags || []).map((tag, i) => <span key={i} className="badge src">{tag}</span>)
  return (
    <div className={`app skill${done ? ' done' : ''}`} role="button" tabIndex={0}
      aria-label={`复制「${s.name}」的安装提示词`} onClick={copy}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy() } }}>
      <div className="top"><div className="ico">{s.ico}</div><h3>{s.name}</h3></div>
      <Desc text={s.desc} lines={5} />
      <div className="meta">{tags}</div>
      <div className="go">点击复制安装提示词</div>
    </div>
  )
}

export default function App() {
  const [showApi] = useState(() => new URLSearchParams(location.search).get('show') === 'true')
  const [toast, setToast] = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [apiSearch, setApiSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const me = useMe() // undefined=探测中; null=未登录; object=已登录
  const toastTimer = useRef(null)

  const showToast = (msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2000)
  }

  const totalEp = APIS.reduce((n, c) => n + c.items.length, 0)
  const avatarUrl = me?.picture || me?.avatar_url || me?.avatar || ''
  const userLabel = me?.name || me?.email || '已登录'

  const visibleCats = useMemo(() => {
    const q = apiSearch.trim().toLowerCase()
    return APIS
      .map(cat => ({
        ...cat,
        items: cat.items.filter(it => !q || it.p.toLowerCase().includes(q) || it.d.toLowerCase().includes(q))
      }))
      .filter(cat => (activeCat === 'all' || cat.key === activeCat) && cat.items.length > 0)
  }, [apiSearch, activeCat])

  const copyApi = (p) => {
    const full = /^https?:\/\//.test(p) ? p : API_BASE + p
    navigator.clipboard.writeText(full).then(() => showToast('已复制：' + full))
      .catch(() => showToast('复制失败，请手动复制：' + full))
  }

  return (
    <>
      <nav className="nav">
        <div className="wrap">
          <div className="brand">朕知道了 · 应用与接口</div>
          <button className="nav-toggle" type="button" aria-label={menuOpen ? '收起菜单' : '展开菜单'}
            aria-expanded={menuOpen} aria-controls="main-menu" onClick={() => setMenuOpen(v => !v)}>
            <span /><span /><span />
          </button>
          <div className={`nav-links${menuOpen ? ' open' : ''}`} id="main-menu">
            <a href="#apps" onClick={() => setMenuOpen(false)}>网页应用</a>
            <a href="#desktop" onClick={() => setMenuOpen(false)}>桌面端应用</a>
            <a href="#skills" onClick={() => setMenuOpen(false)}>Skills</a>
            {showApi && <a href="#apis" onClick={() => setMenuOpen(false)}>API 接口</a>}
            {showApi && <a href="https://utils.api.zhenzhidaole.com/doc">接口文档</a>}
            <span className="nav-auth">
              {me === undefined ? null : me ? (
                <>
                  <span className="nav-user" title={me.email || me.sub}>
                    <span className="nav-avatar" aria-hidden="true">
                      <span className="nav-avatar-fallback">{userLabel.slice(0, 1).toUpperCase()}</span>
                      {avatarUrl && <img src={avatarUrl} alt="" referrerPolicy="no-referrer"
                        onError={e => { e.currentTarget.remove() }} />}
                    </span>
                    <span className="nav-user-name">{userLabel}</span>
                  </span>
                  <a href={logoutUrl()}>退出</a>
                </>
              ) : (
                <a href={loginUrl()}>登录</a>
              )}
            </span>
          </div>
        </div>
      </nav>

      <header className="hero">
        <div className="wrap">
          <h1>朕知道了 门户 · 网页应用 / 桌面端应用 / Skill / API 接口</h1>
          <p>网页应用、桌面客户端与后端接口的一站式入口。找工具、查接口，一步到位。</p>
          <div className="tags">
            <span>网页应用</span><span>桌面端应用</span><span>通用接口</span><span>用户认证</span>
            <span>企业微信</span><span>微信 / 钉钉</span><span>会议签到</span><span>Edge TTS</span><span>SSO / OIDC</span><span>Skill 安装</span>
          </div>
        </div>
      </header>

      <main className="wrap">
        <section id="apps">
          <div className="sec-head"><h2>网页应用</h2><span className="count">（{APPS.length} 个）</span></div>
          <p className="sec-sub">已上线的应用点「访问」打开；可直接打开的静态应用点「打开」访问。</p>
          <div className="grid">
            {APPS.map((a, i) => <AppCard key={i} a={a} />)}
          </div>
        </section>

        <section id="desktop">
          <div className="sec-head"><h2>桌面端应用</h2><span className="count">（{DESKTOP_APPS.length} 个）</span></div>
          <p className="sec-sub">原生客户端，点「前往下载」到官网获取对应平台的安装包。</p>
          <div className="grid">
            {DESKTOP_APPS.map((a, i) => <AppCard key={i} a={a} />)}
          </div>
        </section>

        <section id="skills">
          <div className="sec-head"><h2>Skills</h2><span className="count">（{SKILLS.length} 个）</span></div>
          <p className="sec-sub">点击卡片直接复制「安装提示词」，粘贴到 WorkBuddy 即可从本站 URL 安装该 Skill。新增 Skill 放入 <code>skills/</code> 目录即自动收录；网页应用内提供、未放入该目录的 Skill 用 <code>url</code> 字段显式指定安装地址。</p>
          <div className="grid">
            {SKILLS.map((s, i) => <SkillCard key={i} s={s} />)}
          </div>
        </section>

        {showApi && (
          <section id="apis">
            <div className="sec-head"><h2>API 接口</h2><span className="count">（{APIS.length} 类 · {totalEp} 个接口）</span></div>
            <p className="sec-sub">基础地址 <code>{API_BASE}</code>；全部支持 CORS 跨域。点击路径右侧可复制完整接口地址。</p>
            <div className="api-tools">
              <label className="search">🔍
                <input value={apiSearch} onChange={e => setApiSearch(e.target.value)} placeholder="搜索接口路径或说明，如 /wecom、邮件、TTS…" />
              </label>
              <div className="chips">
                <button className={`chip${activeCat === 'all' ? ' active' : ''}`} onClick={() => setActiveCat('all')}>全部</button>
                {APIS.map(c => (
                  <button key={c.key} className={`chip${activeCat === c.key ? ' active' : ''}`} onClick={() => setActiveCat(c.key)}>
                    {c.label} ({c.items.length})
                  </button>
                ))}
              </div>
            </div>
            <div id="apiList">
              {visibleCats.length === 0
                ? <div className="empty">没有匹配的接口</div>
                : visibleCats.map(cat => (
                  <div className="cat" key={cat.key}>
                    <div className="cat-title"><span className="n">{cat.label}</span></div>
                    {cat.items.map((it, i) => (
                      <div className="ep" key={i}>
                        <span className={`m ${it.m}`}>{it.m}</span>
                        <span className="path">{it.p}</span>
                        <span className="d">{it.d}</span>
                        <button className="copy" onClick={() => copyApi(it.p)}>复制</button>
                      </div>
                    ))}
                  </div>
                ))
              }
            </div>
          </section>
        )}
      </main>

      <footer>
        <div className="wrap">
          本门户聚合 <strong>website/</strong> 下的网页应用、桌面端应用与 <strong>utils_api/</strong> 后端接口。
          完整接口说明见 <a href="../utils_api/API.md">API.md</a>。
          网页应用统一收纳于 <code>webapps/</code> 目录（会议签到、旅途行程规划）。
          Skill 收录于 <code>webapps/skills/</code> 目录；点击卡片复制安装提示词，从本站 URL 一键安装。
          <div style={{ marginTop: 8 }}>
            <a href="/faq.html">常见问题 FAQ</a> · <a href="/authentic.html">正品与商标权属声明</a>
          </div>
        </div>
      </footer>

      <div className={`toast${toast ? ' show' : ''}`}>{toast}</div>
    </>
  )
}
