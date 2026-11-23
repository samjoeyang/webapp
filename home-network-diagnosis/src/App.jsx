import React, { useRef, useState, useEffect, useCallback } from "react";

/* ---------- 配置 ---------- */
const EP = [
  { name: "百度", url: "https://www.baidu.com" },
  { name: "淘宝", url: "https://www.taobao.com" },
  { name: "腾讯", url: "https://www.qq.com" },
  { name: "BootCDN", url: "https://cdn.bootcdn.net" },
  { name: "哔哩哔哩", url: "https://www.bilibili.com/favicon.ico" },
  { name: "抖音", url: "https://www.douyin.com/favicon.ico" }
];
const ROUNDS = 20;          // 全面检测每节点采样轮数
const MON_ROUNDS = 8;       // 监控模式每轮采样数
const TIMEOUT = 2500;       // 单次探测超时(ms)，超时视为"丢包"
const JITTER_THRESH = 25;   // 抖动告警阈值(ms)
const HISTORY_MAX = 120;

/* ---------- 自适应 URL：域名/路径自适应 + 查询参数全保留 ----------
 * 迁移/部署说明：本工具对任何固定域名、绝对路径都无依赖。
 * 自身资源一律相对引用；所有自引用都经 SELF 在运行时基于 location 推导，
 * 并默认保留 URL 中的全部查询参数（如 ?ref=、?theme=、?endpoint= 等）。
 * 换域名、换子路径、带参数部署均无需改代码。                                */
const SELF = (() => {
  const loc = new URL(location.href);
  const segs = loc.pathname.split("/");
  // React MPA 入口是目录形式的 /home-network-diagnosis/（pathname 以 / 结尾），
  // 此时不应回退到旧的 network-check.html 文件名，直接把目录路径当作本页地址
  const file = segs.pop() || "";                          // 当前页面文件名（目录形式时为空串）
  const dir = segs.join("/") + (segs.length ? "/" : "");  // 当前所在目录（兼容子路径部署）
  const params = new URLSearchParams(loc.search);          // 当前全部查询参数
  // url(overrides?, sibling?) -> 指向本页(或同目录 sibling 文件)的完整 URL
  // 默认保留全部现有查询参数；overrides 中同名键覆盖、值为 "" / null / undefined 则删除
  function url(overrides, sibling) {
    const u = new URL(loc.origin + dir + (sibling || file));
    const p = new URLSearchParams(params);                 // 复制并保留全部现有参数
    if (overrides) for (const k in overrides) {
      const v = overrides[k];
      if (v === null || v === undefined || v === "") p.delete(k);
      else p.set(k, String(v));
    }
    u.search = p.toString();
    return u.toString();
  }
  return { origin: loc.origin, dir, file, params, url, raw: loc.href };
})();

/* ---------- 纯逻辑（与视图无关） ---------- */
async function probe(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = performance.now();
  try {
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    const rtt = performance.now() - t0;
    clearTimeout(to);
    return { ok: true, rtt };
  } catch (e) {
    clearTimeout(to);
    return { ok: false, rtt: TIMEOUT };
  }
}

function stats(arr) {
  const v = arr.filter(x => x < TIMEOUT);
  if (!v.length) return { avg: 0, min: 0, max: 0, jit: 0, loss: 100, samples: arr.length };
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const min = Math.min(...v), max = Math.max(...v);
  let jit = 0;
  for (let i = 1; i < v.length; i++) jit += Math.abs(v[i] - v[i - 1]);
  jit = v.length > 1 ? jit / (v.length - 1) : 0;
  const loss = (arr.length - v.length) / arr.length * 100;
  return { avg, min, max, jit, loss, samples: arr.length };
}

/* 一轮：所有节点并行探测（写入传入的 hist 对象） */
async function round(hist) {
  const proms = EP.map(e => probe(e.url));
  const res = await Promise.all(proms);
  EP.forEach((e, i) => {
    hist[e.name].push(res[i].ok ? res[i].rtt : TIMEOUT);
    if (hist[e.name].length > HISTORY_MAX) hist[e.name].shift();
  });
  return res;
}

/* ---------- 同步抖动判定 ---------- */
function syncAnalysis(hist) {
  const names = EP.map(e => e.name);
  let syncRounds = 0, totalRounds = 0;
  const lens = names.map(n => hist[n].length);
  const n = Math.min(...lens);
  if (n < 5) return { ok: false };
  const baselines = names.map(nm => {
    const v = hist[nm].filter(x => x < TIMEOUT); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : TIMEOUT;
  });
  let spikeInRound = new Array(n).fill(0);
  for (let r = 0; r < n; r++) {
    let spiked = 0;
    names.forEach((nm, i) => {
      const v = hist[nm][r];
      if (v >= TIMEOUT || v > baselines[i] + 40) spiked++;
    });
    spikeInRound[r] = spiked;
    if (spiked >= 2) syncRounds++;
  }
  totalRounds = n;
  const ratio = syncRounds / totalRounds;
  return { ok: true, ratio, syncRounds, totalRounds };
}

/* ---------- WebRTC / NAT ---------- */
function stunPublic(stunUrl) {
  return new Promise(resolve => {
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrl }] }); } catch (e) { resolve(null); return; }
    pc.createDataChannel("x");
    let addr = null;
    pc.onicecandidate = e => {
      if (!e.candidate) return;
      const c = e.candidate.candidate;
      const m = c.match(/(\d+\.\d+\.\d+\.\d+):(\d+)/);
      const t = c.match(/typ (\w+)/);
      if (m && t && t[1] === "srflx") addr = m[1] + ":" + m[2];
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) { } resolve(addr); }, 3000);
  });
}
function gatherAll() {
  return new Promise(resolve => {
    const pub = new Set(), loc = new Set();
    let pc;
    try { pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }); } catch (e) { resolve({ pub: [], loc: [], err: true }); return; }
    pc.createDataChannel("x");
    pc.onicecandidate = e => {
      if (!e.candidate) return;
      const c = e.candidate.candidate;
      const m = c.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) {
        const ip = m[1];
        if (ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith("169.254.") || ip === "127.0.0.1" || ip.startsWith("100.")) loc.add(ip);
        else pub.add(ip);
      }
    };
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
    setTimeout(() => { try { pc.close(); } catch (e) { } resolve({ pub: [...pub], loc: [...loc] }); }, 4000);
  });
}

/* ---------- Clash 本地安全检测（纯逻辑） ---------- */
async function clashProbe(base) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 3000);
  const out = { reachable: false, version: null, proxiesOpen: false, needsAuth: false, err: null };
  try {
    const vRes = await fetch(base + "/version", { mode: "cors", cache: "no-store", signal: ctrl.signal });
    out.reachable = true;
    if (vRes.ok) { try { out.version = (await vRes.json()).version || "(未知)"; } catch (_) { } }
    const pRes = await fetch(base + "/proxies", { mode: "cors", cache: "no-store", signal: ctrl.signal });
    if (pRes.ok) out.proxiesOpen = true;
    else if (pRes.status === 401 || pRes.status === 403) out.needsAuth = true;
  } catch (e) {
    if (e.name === "AbortError") out.err = "连接超时(3s)";
    else out.err = (e && e.message) || "连接失败";
  } finally { clearTimeout(to); }
  return out;
}

/* ---------- Clash 外部资产搜索链接（与原始一致） ---------- */
const FOFA_HREF = (() => {
  const q = 'body="\\"hello\\":\\"mihomo\\"" || body="\\"hello\\":\\"clash\\""';
  return "https://fofa.info/result?qbase64=" + btoa(q);
})();
const SHODAN_HREF = "https://www.shodan.io/search?query=port%3A9090%2C9097";
const ZOOMEYE_HREF = "https://www.zoomeye.org/searchResult?q=port%3A%229090%22%2C%229097%22";

/* ---------- 颜色映射（图表/状态共用） ---------- */
const COLS = { "百度": "#2f6df6", "淘宝": "#1f9d55", "腾讯": "#e08a00", "BootCDN": "#9b59b6", "哔哩哔哩": "#fb7299", "抖音": "#06b6d4" };

function logColor(cls) {
  return cls === "bad" ? "var(--bad)" : cls === "ok" ? "var(--ok)" : cls === "warn" ? "var(--warn)" : "";
}

export default function App() {
  /* ---------- 状态（可变核心，保持与原始 state 同构） ---------- */
  const stateRef = useRef({
    hist: {}, results: {}, running: false, monitor: false, monitorTimer: null,
    ipv4: null, ipv6: null, bb: null, rtc: null, local: null, sec: null,
    dl: null, ul: null
  });
  EP.forEach(e => { if (!stateRef.current.hist[e.name]) stateRef.current.hist[e.name] = []; });

  /* ---------- 画布 ref ---------- */
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);

  /* ---------- UI 状态 ---------- */
  const [logLines, setLogLines] = useState([]);
  const [running, setRunning] = useState(false);
  const [runLabel, setRunLabel] = useState("▶ 开始全面检测");
  const [monitor, setMonitor] = useState(false);
  const [ipv4Disp, setIpv4Disp] = useState("--");
  const [ipv6Disp, setIpv6Disp] = useState("--");
  const [dlDisp, setDlDisp] = useState("--");
  const [ulDisp, setUlDisp] = useState("--");
  const [dlBar, setDlBar] = useState(0);
  const [dnsHtml, setDnsHtml] = useState('<div class="muted">检测中…</div>');
  const [ipv6Html, setIpv6Html] = useState('<div class="muted">检测中…</div>');
  const [bbHtml, setBbHtml] = useState('<div class="muted">检测中…（全面检测时自动运行：边下载边测延迟）</div>');
  const [rtcHtml, setRtcHtml] = useState('<div class="muted">检测中…（暴露的真实公网/内网 IP 与 NAT 类型）</div>');
  const [localHtml, setLocalHtml] = useState('<div class="muted">检测中…（仅扫描本机 127.0.0.1，安全）</div>');
  const [secHtml, setSecHtml] = useState('<div class="muted">检测中…（HTTPS / DoH / 混合内容）</div>');
  const [clashHtml, setClashHtml] = useState('<div class="muted">检测本机 Clash / Mihomo 的「外部控制端口」是否在无密钥状态下可被本地网页读取。仅在本机运行，不触碰任何外部主机。（若页面以 HTTPS 打开，浏览器可能拦截对 127.0.0.1 的明文请求；如遇全部「未暴露」但确认 Clash 在运行，请用 http:// 或 file:// 协议打开本页。）</div>');
  const [latRowsHtml, setLatRowsHtml] = useState(
    '<tr><td colspan="6" class="muted">点击「开始全面检测」后显示</td></tr>'
  );
  const [syncVerdictHtml, setSyncVerdictHtml] = useState("");
  const [diagHtml, setDiagHtml] = useState('<div class="muted">运行检测后，这里会给出综合判定与分级修复建议。</div>');
  const [checklistItems, setChecklistItems] = useState([]);
  const [verdict, setVerdict] = useState("尚未检测");
  const [score, setScore] = useState(null);
  const [ringColor, setRingColor] = useState("var(--sub)");
  const [cType, setCType] = useState("检测中…");
  const [clashHost, setClashHost] = useState("127.0.0.1");
  const [clashPorts, setClashPorts] = useState("9090, 9097");
  const [clashRunning, setClashRunning] = useState(false);
  const [chartVersion, setChartVersion] = useState(0);

  const redraw = useCallback(() => setChartVersion(v => v + 1), []);

  /* ---------- 日志 ---------- */
  const log = useCallback((msg, cls) => {
    const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setLogLines(prev => [...prev, { t, msg, cls }]);
  }, []);

  /* ---------- 图表绘制 ---------- */
  const drawChart = useCallback(() => {
    const cv = canvasRef.current, ctx = ctxRef.current;
    if (!cv || !ctx) return;
    const W = cv.clientWidth, H = cv.clientHeight;
    const css = getComputedStyle(document.body);
    const cLine = css.getPropertyValue("--line").trim();
    const cSub = css.getPropertyValue("--sub").trim();
    const cTxt = css.getPropertyValue("--txt").trim();
    const cols = COLS;
    ctx.clearRect(0, 0, W, H);
    let maxV = 50;
    const hist = stateRef.current.hist;
    EP.forEach(e => hist[e.name].forEach(v => maxV = Math.max(maxV, v)));
    maxV = Math.min(maxV * 1.1, TIMEOUT);
    const L = 38, R = 10, T = 14, B = 22;
    const x = i => L + (W - L - R) * i / Math.max(ROUNDS - 1, 1);
    const y = v => H - B - (H - T - B) * v / maxV;
    ctx.strokeStyle = cLine; ctx.fillStyle = cSub; ctx.font = "11px sans-serif"; ctx.lineWidth = 1;
    for (let k = 0; k <= 5; k++) {
      const vv = maxV * k / 5, yy = y(vv);
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(vv.toFixed(0), L - 5, yy + 4);
    }
    ctx.textAlign = "center"; ctx.fillText("采样轮次 →", (W) / 2, H - 4);
    EP.forEach(e => {
      const d = hist[e.name]; if (!d.length) return;
      const col = cols[e.name] || "#888";
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
      d.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
      ctx.fillStyle = "rgba(214,69,69,.55)";
      d.forEach((v, i) => { if (v >= TIMEOUT) { ctx.beginPath(); ctx.arc(x(i), y(TIMEOUT), 2.4, 0, 7); ctx.fill(); } });
    });
    let lx = L + 4, ly = T + 8;
    EP.forEach(e => {
      ctx.fillStyle = cols[e.name] || "#888"; ctx.fillRect(lx, ly - 8, 9, 9);
      ctx.fillStyle = cTxt; ctx.textAlign = "left"; ctx.fillText(e.name, lx + 12, ly);
      lx += ctx.measureText(e.name).width + 30;
    });
  }, []);

  const resize = useCallback(() => {
    const cv = canvasRef.current; if (!cv) return;
    cv.width = cv.clientWidth * 2; cv.height = cv.clientHeight * 2;
    ctxRef.current.scale(2, 2);
    drawChart();
  }, [drawChart]);

  /* ---------- 画布 effect：挂载时初始化 + resize 监听 ---------- */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    ctxRef.current = cv.getContext("2d");
    resize();
    const onR = () => resize();
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, [resize]);

  /* 数据变化 / 窗口变化后重绘 */
  useEffect(() => { drawChart(); }, [chartVersion, drawChart]);

  /* 日志自动滚动 */
  const logRef = useRef(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines]);

  /* ---------- 连接基线 ---------- */
  const renderConn = useCallback(() => {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) {
      const map = { slow2g: "极慢 2G", "2g": "2G", "3g": "3G", "4g": "4G", wifi: "WiFi", ethernet: "有线", cellular: "蜂窝" };
      setCType((map[c.effectiveType] || c.effectiveType || "未知")
        + (c.downlink ? (" · " + c.downlink + "Mbps") : "") + (c.rtt ? (" · RTT≈" + c.rtt + "ms") : ""));
    } else {
      setCType("浏览器未提供（可用）");
    }
  }, []);

  /* ---------- 延迟表 + 同步判定 ---------- */
  const renderLatTable = useCallback(() => {
    const S = stateRef.current;
    let rows = "";
    EP.forEach(e => {
      const s = S.results[e.name] || { avg: 0, min: 0, max: 0, jit: 0, loss: 0 };
      const lossTag = s.loss > 2 ? '<span class="tag bad">' + s.loss.toFixed(0) + '%</span>'
        : s.loss > 0 ? '<span class="tag warn">' + s.loss.toFixed(0) + '%</span>'
          : '<span class="tag ok">0%</span>';
      const jit = s.jit > JITTER_THRESH ? '<span class="tag warn">' + s.jit.toFixed(0) + '</span>'
        : '<span class="tag ok">' + s.jit.toFixed(0) + '</span>';
      rows += `<tr><td>${e.name}</td><td>${s.avg.toFixed(0)}</td><td>${s.min.toFixed(0)}</td>
      <td>${s.max.toFixed(0)}</td><td>${jit}</td><td>${lossTag}</td></tr>`;
    });
    setLatRowsHtml(rows);
    const sa = syncAnalysis(S.hist);
    if (sa.ok) {
      if (sa.ratio > 0.25) {
        setSyncVerdictHtml(`<span class="tag bad">同步抖动</span> 约 ${(sa.ratio * 100).toFixed(0)}% 的轮次出现多节点同时尖峰 → <b>根因在本地/路由器</b>（bufferbloat 或路由器性能），而非远端服务器。`);
      } else if (sa.ratio > 0) {
        setSyncVerdictHtml(`<span class="tag ok">异步</span> 节点尖峰不同步（${(sa.ratio * 100).toFixed(0)}%），多为各服务器自身波动。`);
      } else {
        setSyncVerdictHtml(`<span class="tag ok">平稳</span> 未检测到明显同步抖动。`);
      }
    } else {
      setSyncVerdictHtml("");
    }
  }, []);

  /* ---------- 网速 ---------- */
  const runSpeed = useCallback(async () => {
    const urls = {
      dl: "https://speed.cloudflare.com/__down?bytes=20000000",
      ul: "https://speed.cloudflare.com/__up?bytes=5000000"
    };
    const S = stateRef.current;
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
      const t0 = performance.now();
      const res = await fetch(urls.dl, { cache: "no-store", signal: ctrl.signal });
      const buf = await res.arrayBuffer();
      clearTimeout(to);
      const dt = (performance.now() - t0) / 1000;
      const mbps = (buf.byteLength * 8 / dt) / 1e6;
      S.dl = mbps;
      setDlDisp(mbps.toFixed(1) + '<small> Mbps</small>');
      setDlBar(Math.min(100, mbps / 2));
      log(`下载速度 ${mbps.toFixed(1)} Mbps`, "ok");
    } catch (e) {
      S.dl = null;
      setDlDisp('不可用<small> </small>');
      setDlBar(0);
      log("下载测速节点不可达（网络限制），跳过", "warn");
    }
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 15000);
      const body = new Blob([new Uint8Array(5000000)]);
      const t0 = performance.now();
      await fetch(urls.ul, { method: "POST", body, cache: "no-store", signal: ctrl.signal });
      clearTimeout(to);
      const dt = (performance.now() - t0) / 1000;
      const mbps = (5000000 * 8 / dt) / 1e6;
      S.ul = mbps;
      setUlDisp(mbps.toFixed(1) + '<small> Mbps</small>');
      log(`上传速度 ${mbps.toFixed(1)} Mbps`, "ok");
    } catch (e) {
      S.ul = null;
      setUlDisp('不可用<small> </small>');
    }
  }, [log]);

  /* ---------- IP / IPv6 ---------- */
  const runIp = useCallback(async () => {
    const S = stateRef.current;
    async function getText(u) {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 6000);
      try { const r = await fetch(u, { cache: "no-store", signal: ctrl.signal }); clearTimeout(to); return (await r.text()).trim(); }
      catch (e) { clearTimeout(to); return null; }
    }
    const v4 = await getText("https://ipv4.icanhazip.com");
    const v6 = await getText("https://ipv6.icanhazip.com");
    S.ipv4 = v4; S.ipv6 = v6;
    setIpv4Disp(v4 || "未获取");
    setIpv6Disp(v6 || "未获取");
    if (v6) {
      setIpv6Html(`<span class="tag ok">已支持 IPv6</span><div class="row" style="margin-top:8px"><span>IPv6 地址</span><b>${v6}</b></div>
      <div class="muted" style="margin-top:6px">本机可经 IPv6 出网。若 IPv4 抖动严重，可尝试在系统/路由器优先 IPv6。</div>`);
      log("IPv6 出网正常：" + v6, "ok");
    } else {
      setIpv6Html(`<span class="tag warn">未检测到 IPv6</span><div class="muted" style="margin-top:6px">当前网络可能未分配公网 IPv6，或浏览器未走 IPv6。不影响上网，但不享受 IPv6 路径。</div>`);
      log("未检测到 IPv6 出网", "warn");
    }
  }, [log]);

  /* ---------- DNS ---------- */
  const runDns = useCallback(async () => {
    const domains = ["www.baidu.com", "www.taobao.com"];
    let times = [];
    for (const d of domains) {
      for (let k = 0; k < 2; k++) {
        const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 3000);
        const t0 = performance.now();
        try {
          await fetch("https://" + d, { mode: "no-cors", cache: k === 0 ? "no-store" : "force-cache", signal: ctrl.signal });
          const dt = performance.now() - t0; clearTimeout(to);
          if (k === 0) times.push(dt);
        } catch (e) { clearTimeout(to); }
      }
    }
    if (times.length) {
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const tag = avg < 60 ? '<span class="tag ok">正常</span>' : avg < 150 ? '<span class="tag warn">偏慢</span>' : '<span class="tag bad">慢</span>';
      setDnsHtml(`<div class="row"><span>解析+建连耗时(估)</span><b>${avg.toFixed(0)} ms ${tag}</b></div>
      <div class="muted" style="margin-top:6px">建议系统/路由器 DNS 设为 <b>119.29.29.29（腾讯）</b> 主、<b>114.114.114.114</b> 备，兼顾速度与稳定。</div>`);
      log(`DNS 解析+建连约 ${avg.toFixed(0)} ms`, avg < 60 ? "ok" : "warn");
    } else {
      setDnsHtml(`<div class="muted">DNS 检测失败</div>`);
    }
  }, [log]);

  /* ---------- 饱和 / Bufferbloat ---------- */
  const idleLatency = useCallback(async () => {
    const targets = ["https://www.baidu.com", "https://www.taobao.com", "https://www.qq.com"];
    const r = await Promise.all(targets.map(probe));
    const ok = r.filter(x => x.ok);
    return ok.length ? ok.reduce((a, b) => a + b.rtt, 0) / ok.length : TIMEOUT;
  }, []);
  const runBufferbloat = useCallback(async () => {
    const S = stateRef.current;
    setBbHtml('<div class="muted">测量空闲延迟…</div>');
    let idle = 0, n = 0;
    for (let i = 0; i < 6; i++) { const v = await idleLatency(); if (v < TIMEOUT) { idle += v; n++; } }
    idle = n ? idle / n : TIMEOUT;
    setBbHtml('<div class="muted">空闲延迟 ' + idle.toFixed(0) + 'ms，开始下载加压…</div>');
    let loadedSum = 0, loadedN = 0;
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 35000);
      const res = await fetch("https://speed.cloudflare.com/__down?bytes=60000000", { cache: "no-store", signal: ctrl.signal });
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
        const v = await idleLatency();
        if (v < TIMEOUT) { loadedSum += v; loadedN++; }
      }
      clearTimeout(to);
    } catch (e) {
      setBbHtml('<div class="muted">饱和测试下载节点不可达（网络限制），跳过。可用时再测。</div>');
      log("饱和测试节点不可达，跳过", "warn");
      S.bb = null; return;
    }
    const loaded = loadedN ? loadedSum / loadedN : TIMEOUT;
    const delta = loaded - idle;
    let grade, gcol, gtxt;
    if (delta < 30) { grade = "A"; gcol = "var(--ok)"; gtxt = "优秀：满载几乎不增加延迟，无明显 bufferbloat。"; }
    else if (delta < 60) { grade = "B"; gcol = "var(--ok)"; gtxt = "良好：仅有轻微增加。"; }
    else if (delta < 120) { grade = "C"; gcol = "var(--warn)"; gtxt = "一般：满载延迟明显上升，存在 bufferbloat 迹象。"; }
    else if (delta < 200) { grade = "D"; gcol = "var(--warn)"; gtxt = "较差：满载延迟大幅上升，bufferbloat 明显。"; }
    else { grade = "F"; gcol = "var(--bad)"; gtxt = "严重：满载延迟剧增，典型 bufferbloat，强烈建议开启路由器 QoS/SQM。"; }
    S.bb = { idle, loaded, delta, grade };
    setBbHtml(`<div class="row"><span>空闲延迟</span><b>${idle.toFixed(0)} ms</b></div>
    <div class="row"><span>满载延迟</span><b style="color:${gcol}">${loaded.toFixed(0)} ms</b></div>
    <div class="row"><span>延迟增量</span><b style="color:${gcol}">+${delta.toFixed(0)} ms</b></div>
    <div style="margin-top:8px"><span class="tag ${grade === 'A' || grade === 'B' ? 'ok' : grade === 'C' ? 'warn' : 'bad'}">评级 ${grade}</span></div>
    <div class="muted" style="margin-top:6px">${gtxt}</div>`);
    log(`Bufferbloat 评级 ${grade}：空闲 ${idle.toFixed(0)} / 满载 ${loaded.toFixed(0)}ms (+${delta.toFixed(0)})`, grade === 'F' || grade === 'D' ? "bad" : grade === 'C' ? "warn" : "ok");
  }, [log, idleLatency]);

  /* ---------- WebRTC 隐私 / NAT ---------- */
  const runWebRTC = useCallback(async () => {
    const S = stateRef.current;
    setRtcHtml('<div class="muted">正在通过 STUN 收集候选地址…</div>');
    const g = await gatherAll();
    const a1 = await stunPublic("stun:stun.l.google.com:19302");
    const a2 = await stunPublic("stun:stun.cloudflare.com:3478");
    let nat = "未知";
    if (a1 && a2) nat = (a1 === a2) ? "锥形 NAT（较宽松）" : "对称型 NAT（最严格）";
    else if (a1 || a2) nat = "经 NAT（类型未能精确判定）";
    else nat = "未获取到公网反射地址（可能被防火墙拦截）";
    const leak = (g.pub.length > 0);
    const vpnNote = (S.ipv4 && g.pub.length && !g.pub.includes(S.ipv4))
      ? "WebRTC 暴露的公网 IP 与页面检测到的不同 → 你可能在使用代理/VPN，且 WebRTC 走的是真实网络（注意隐私）。"
      : (g.pub.length && S.ipv4 && g.pub.includes(S.ipv4))
        ? "WebRTC 暴露的公网 IP 与当前出口一致 → 真实 IP 可见（若你期望隐藏，说明 VPN/代理未覆盖 WebRTC）。"
        : "";
    S.rtc = { pub: g.pub, loc: g.loc, nat, leak };
    const leakTag = leak ? '<span class="tag warn">暴露公网IP</span>' : '<span class="tag ok">未暴露</span>';
    setRtcHtml(`<div class="row"><span>WebRTC 暴露公网 IP</span><b>${g.pub.length ? g.pub.join(", ") : "无"} ${leakTag}</b></div>
    <div class="row"><span>内网 IP</span><b>${g.loc.length ? g.loc.join(", ") : "无"}</b></div>
    <div class="row"><span>NAT 类型</span><b>${nat}</b></div>
    <div class="muted" style="margin-top:6px">${vpnNote || "仅你自己的浏览器/网络信息，未触碰任何外部目标。"}</div>`);
    log(`WebRTC：${leak ? "暴露公网IP " : "未暴露公网IP"}+ NAT=${nat}`, leak ? "warn" : "ok");
  }, [log]);

  /* ---------- 本地服务暴露扫描 ---------- */
  const scanPort = useCallback(async (p) => {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 800);
    try {
      await fetch("http://127.0.0.1:" + p, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      clearTimeout(to); return true;
    } catch (e) { clearTimeout(to); return false; }
  }, []);
  const runLocalScan = useCallback(async () => {
    const S = stateRef.current;
    setLocalHtml('<div class="muted">扫描本机 127.0.0.1 常见端口…</div>');
    const PORTS = [[22, "SSH"], [80, "HTTP"], [443, "HTTPS"], [3306, "MySQL"], [5432, "PostgreSQL"], [6379, "Redis"], [8080, "HTTP-Alt"], [8443, "HTTPS-Alt"], [9200, "Elasticsearch"], [27017, "MongoDB"], [3389, "RDP"], [5900, "VNC"], [8888, "Jupyter"], [3000, "Dev"], [5000, "Flask"], [8000, "HTTP"]];
    const dangerous = new Set([3306, 5432, 6379, 9200, 27017, 3389, 5900, 8888]);
    let open = [], danger = [];
    for (const pr of PORTS) {
      const ok = await scanPort(pr[0]);
      if (ok) { open.push(pr[1] + "(" + pr[0] + ")"); if (dangerous.has(pr[0])) danger.push(pr[1] + "(" + pr[0] + ")"); }
    }
    S.local = { open, danger };
    if (open.length === 0) {
      setLocalHtml('<span class="tag ok">未发现监听端口</span><div class="muted" style="margin-top:6px">本机常见端口均未响应（若页面以 HTTPS 打开，浏览器会禁止访问 http://127.0.0.1，导致本项为空；如需检测请在 http 或 file 协议下打开）。</div>');
    } else {
      const dt = danger.length ? '<span class="tag bad">危险服务暴露</span>' : '<span class="tag ok">无非必要危险服务</span>';
      setLocalHtml(`<div>${dt}</div>
      <div class="row" style="margin-top:6px"><span>开放端口</span><b>${open.join("、")}</b></div>
      ${danger.length ? `<div class="muted" style="margin-top:6px">⚠️ 发现潜在危险服务：${danger.join("、")}。若非必要，请在防火墙/服务配置中关闭，避免被局域网或恶意页面利用。</div>` : ""}`);
    }
    log(`本地扫描：开放 ${open.length} 个端口${danger.length ? ("，危险：" + danger.join(",")) : ""}`, danger.length ? "bad" : "ok");
  }, [log, scanPort]);

  /* ---------- 安全 / 加密姿态 ---------- */
  const runSecurity = useCallback(async () => {
    const S = stateRef.current;
    const secure = !!(window.isSecureContext && location.protocol === "https:");
    let mixed = 0;
    try { mixed = performance.getEntriesByType("resource").filter(r => r.name && r.name.startsWith("http://")).length; } catch (e) { }
    let doh = false;
    try {
      const r = await fetch("https://1.1.1.1/dns-query?name=example.com&type=A", { headers: { "Accept": "application/dns-json" }, signal: AbortSignal.timeout(4000) });
      doh = r.ok;
    } catch (e) { }
    S.sec = { secure, mixed, doh };
    const secTag = secure ? '<span class="tag ok">安全上下文</span>' : '<span class="tag warn">非 HTTPS</span>';
    const mixTag = mixed > 0 ? '<span class="tag bad">' + mixed + ' 处混合内容</span>' : '<span class="tag ok">无混合内容</span>';
    const dohTag = doh ? '<span class="tag ok">DoH 可达</span>' : '<span class="tag warn">DoH 不可达</span>';
    setSecHtml(`<div>${secTag} ${mixTag} ${dohTag}</div>
    <div class="row" style="margin-top:6px"><span>页面协议</span><b>${location.protocol}</b></div>
    <div class="muted" style="margin-top:6px">${secure ? "连接经 TLS 加密，安全。" : "当前非 HTTPS，流量易被窃听/劫持。"} DoH 可达仅表示网络支持加密 DNS；浏览器是否启用 DoH 请在浏览器设置中确认。</div>`);
    log(`安全姿态：secure=${secure} mixed=${mixed} doh=${doh}`, !secure || mixed > 0 ? "warn" : "ok");
  }, [log]);

  /* ---------- 评分 + 诊断 ---------- */
  const computeScore = useCallback(() => {
    const S = stateRef.current;
    const rs = Object.values(S.results);
    if (!rs.length) return null;
    const avgAll = rs.reduce((a, s) => a + s.avg, 0) / rs.length;
    const jitAll = rs.reduce((a, s) => a + s.jit, 0) / rs.length;
    const lossAll = rs.reduce((a, s) => a + s.loss, 0) / rs.length;
    let score = 100;
    score -= Math.max(0, (avgAll - 30)) * 0.4;
    score -= Math.max(0, (jitAll - 10)) * 0.8;
    score -= lossAll * 1.5;
    const dl = S.dl || 0;
    if (dl && dl < 10) score -= 15; else if (dl && dl < 30) score -= 5;
    if (S.bb) {
      if (S.bb.grade === "F") score -= 15;
      else if (S.bb.grade === "D") score -= 10;
      else if (S.bb.grade === "C") score -= 5;
    }
    if (S.sec && (!S.sec.secure || S.sec.mixed > 0)) score -= 3;
    return { score: Math.max(0, Math.round(score)), avgAll, jitAll, lossAll };
  }, []);

  const analyze = useCallback(() => {
    const S = stateRef.current;
    const sc = computeScore();
    if (!sc) { return; }
    setScore(sc.score);
    let col = sc.score >= 80 ? "var(--ok)" : sc.score >= 55 ? "var(--warn)" : "var(--bad)";
    setRingColor(col);

    const sa = syncAnalysis(S.hist);
    const avg = sc.avgAll, jit = sc.jitAll, loss = sc.lossAll;
    const dl = S.dl || 0;
    const ul = S.ul || 0;
    const items = [];
    let verdict = "网络良好";
    let level = 3;

    // 测速有效性校验（反常校验）：家庭宽带下行通常远高于上行；
    // 若实测下行 < 上行，强烈提示测速节点/链路异常（节点故障、被限速到单线程等），并非真实网速。
    if (dl && ul && dl < ul) {
      items.push({ lv: 1, t: "⚠️ 测速结果反常（下行 < 上行）", p: "实测下载 " + dl.toFixed(1) + " Mbps 竟低于上传 " + ul.toFixed(1) + " Mbps。家庭宽带下行通常远高于上行，此结果强烈提示<b>测速节点/链路异常</b>（测速网站节点故障、被限速到单线程等），并非你家真实网速。请用<b>路由器官方 App 自带测速</b>或运营商测速页（电信/联通/移动宽带管家）重新验证，并以权威源为准。" });
      level = Math.min(level, 1);
    }

    if (loss > 2) {
      items.push({ lv: 1, t: "检测到明显丢包", p: "多条探测超时（>" + TIMEOUT + "ms）。可能为 WiFi 干扰、路由器过载或运营商链路质量问题。建议：靠近路由器/换 5GHz 信道、重启路由、直连光猫复测。" });
      verdict = "网络异常（丢包）"; level = 1;
    }
    if (sa.ok && sa.ratio > 0.25) {
      items.push({ lv: 1, t: "本地/路由器瓶颈（同步抖动）", p: "多个不同远端在同一时刻一起尖峰，说明瓶颈在本地路径：路由器 CPU/NAT 或 WiFi 调度。最有效的本地手段是在路由器开启 <b>QoS / SQM（智能队列）</b>，能显著缓解 bufferbloat 抖动。" });
      verdict = "本地/路由器瓶颈"; level = Math.min(level, 1);
    } else if (jit > JITTER_THRESH) {
      items.push({ lv: 2, t: "延迟抖动较大", p: "RTT 波动剧烈（抖动 " + jit.toFixed(0) + "ms）。间歇卡顿/缓冲多源于此。优先排查：是否有设备占满带宽（下载/视频通话/NAS 同步），并开启路由器 QoS。" });
      verdict = verdict === "网络良好" ? "延迟抖动偏大" : "网络抖动"; level = Math.min(level, 2);
    }
    if (avg > 80) {
      items.push({ lv: 2, t: "基础延迟偏高", p: "平均往返 " + avg.toFixed(0) + "ms，高于家庭宽带正常水平（通常<40ms）。若为 WiFi，尝试靠近路由器；若直连仍高，则可能运营商侧延迟。" });
      level = Math.min(level, 2);
    }
    if (dl && dl < 10) {
      items.push({ lv: 2, t: "带宽偏低", p: "实测下载 " + dl.toFixed(1) + " Mbps，低于常见宽带。确认套餐速率、是否被限速、是否有设备抢占带宽。" });
      level = Math.min(level, 2);
    }
    if (!S.ipv6) {
      items.push({ lv: 3, t: "未启用 IPv6（提示）", p: "当前仅 IPv4。IPv4 抖动时无法自动切换，属可选优化项，可在光猫/路由器开启 IPv6 拨号。" });
    }
    if (S.bb) {
      if (S.bb.grade === "F" || S.bb.grade === "D") {
        items.push({ lv: 1, t: "Bufferbloat 严重（饱和抖动）", p: "下载/上传满载时延迟剧增（空闲 " + S.bb.idle.toFixed(0) + "→满载 " + S.bb.loaded.toFixed(0) + "ms）。这是多人共用或跑大流量时“卡顿/缓冲”的根因。最有效修复：路由器开启 <b>QoS / SQM（智能队列）</b>。" });
        level = Math.min(level, 1);
      } else if (S.bb.grade === "C") {
        items.push({ lv: 2, t: "存在 Bufferbloat 迹象", p: "满载延迟上升（+" + S.bb.delta.toFixed(0) + "ms）。高负载时易卡顿，建议开启路由器 QoS/SQM。" });
        level = Math.min(level, 2);
      }
    }
    if (S.local && S.local.danger && S.local.danger.length) {
      items.push({ lv: 1, t: "本机暴露危险服务", p: "检测到本机开放：" + S.local.danger.join("、") + "。若非必要，请在防火墙/服务配置中关闭，避免被局域网或恶意页面利用。" });
      level = Math.min(level, 1);
    }
    if (S.sec && (!S.sec.secure || S.sec.mixed > 0)) {
      items.push({ lv: 2, t: "连接安全姿态不足", p: (!S.sec.secure ? "当前页面非 HTTPS，流量可被窃听。" : "") + (S.sec.mixed > 0 ? ("存在 " + S.sec.mixed + " 处混合内容。") : "") + "建议使用 HTTPS 并启用 DoH 加密 DNS。" });
      level = Math.min(level, 2);
    }
    if (S.rtc && S.rtc.leak) {
      items.push({ lv: 3, t: "WebRTC 暴露真实公网 IP", p: "浏览器经 WebRTC 暴露了你的公网 IP（" + (S.rtc.pub.join(", ")) + "）。若你期望通过代理/VPN 隐藏真实 IP，需在浏览器禁用 WebRTC 或使用防泄漏扩展。" });
    }
    if (items.length === 0) {
      items.push({ lv: 3, t: "各项指标正常", p: "延迟、抖动、丢包、网速均在健康范围。如仍感觉偶发卡顿，多为间歇性瞬时抖动，可开启下方「持续监控」捕捉发生时刻。" });
    }

    setDiagHtml(items.map(it => `<div class="item lv${it.lv}"><h3>${it.lv === 1 ? "🔴" : it.lv === 2 ? "🟠" : "🟢"} ${it.t}</h3><p>${it.p}</p></div>`).join(""));
    setVerdict(verdict);

    const list = [
      "✅ 已在本页提供：清理浏览器缓存按钮（点上方「🧹 清理浏览器缓存」）。",
      "🔧 重启光猫 + 路由器：清除 NAT 会话/内存泄漏，多数间歇性抽风可解决。",
      "🔧 排查占带宽设备：NAS 同步、大文件下载、视频通话、家人设备大流量最易触发抖动。",
      "🔧 直连光猫复测：网线直连光猫再点「重新检测」，抖动消失→问题在路由器；仍在→在运营商。",
      "🔧 路由器开启 QoS / SQM（智能队列）：缓解 bufferbloat 与同步抖动最有效的本地手段。",
      "📞 若直连光猫仍抖：报修运营商，描述为「延迟抖动大、有尖峰、不丢包」更易受理。",
      "🌐 DNS：路由器改为主 119.29.29.29、备 114.114.114.114（让全家生效）。"
    ];
    if (S.local && S.local.danger && S.local.danger.length)
      list.push("🔒 关闭本机危险服务：" + S.local.danger.join("、") + "（在防火墙/服务配置中禁用）。");
    if (S.sec && !S.sec.secure)
      list.push("🔒 以 HTTPS 访问本工具，并在浏览器启用 DoH（加密 DNS）以防劫持。");
    if (S.rtc && S.rtc.leak)
      list.push("🕵️ 若需隐藏真实 IP：在浏览器禁用 WebRTC 或安装防泄漏扩展。");
    setChecklistItems(list);

    log(`综合评分 ${sc.score}/100，判定：${verdict}`, level === 1 ? "bad" : level === 2 ? "warn" : "ok");
  }, [computeScore, log]);

  /* ---------- 综合检测 ---------- */
  const fullCheck = useCallback(async () => {
    const S = stateRef.current;
    if (S.running) return;
    S.running = true; setRunning(true); setRunLabel("检测中…");
    log("▶ 开始全面检测…");
    EP.forEach(e => S.hist[e.name] = []);
    for (let r = 0; r < ROUNDS; r++) {
      await round(S.hist);
      if (r % 5 === 0) redraw();
    }
    redraw();
    EP.forEach(e => S.results[e.name] = stats(S.hist[e.name]));
    renderLatTable();
    await runIp();
    await runDns();
    await runSecurity();
    await runWebRTC();
    await runLocalScan();
    await runSpeed();
    await runBufferbloat();
    analyze();
    S.running = false; setRunning(false); setRunLabel("▶ 重新检测");
    log("✅ 全面检测完成", "ok");
  }, [log, redraw, renderLatTable, runIp, runDns, runSecurity, runWebRTC, runLocalScan, runSpeed, runBufferbloat, analyze]);

  /* ---------- 浏览器缓存清理 ---------- */
  const clearCache = useCallback(async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
        log(`已清理 ${keys.length} 个 Cache Storage 缓存`, "ok");
      } else log("当前浏览器不支持 Cache API", "warn");
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        regs.forEach(r => r.unregister());
      }
      alert("浏览器端缓存已尝试清理。\n注意：DNS 缓存、路由器缓存需在系统/路由器侧处理（见诊断清单）。");
    } catch (e) { log("清理缓存失败：" + e.message, "bad"); }
  }, [log]);

  /* ---------- 持续监控 ---------- */
  const monitorTick = useCallback(async () => {
    const S = stateRef.current;
    for (let r = 0; r < MON_ROUNDS; r++) await round(S.hist);
    redraw();
    EP.forEach(e => S.results[e.name] = stats(S.hist[e.name]));
    renderLatTable();
    analyze();
    const sc = computeScore();
    if (sc && sc.jitAll > JITTER_THRESH) {
      log(`⚠️ 监控告警：当前抖动 ${sc.jitAll.toFixed(0)}ms 超阈值`, "bad");
    }
  }, [redraw, renderLatTable, analyze, computeScore, log]);

  const toggleMonitor = useCallback(() => {
    const S = stateRef.current;
    S.monitor = !S.monitor;
    setMonitor(S.monitor);
    if (S.monitor) {
      log("开启持续监控，每 60 秒采样一次");
      S.monitorTimer = setInterval(() => monitorTick(), 60000);
      monitorTick();
    } else {
      clearInterval(S.monitorTimer);
      S.monitorTimer = null;
      log("已关闭持续监控");
    }
  }, [log, monitorTick]);

  /* ---------- 报告导出 ---------- */
  const exportReport = useCallback(() => {
    const S = stateRef.current;
    const sc = computeScore();
    const sa = syncAnalysis(S.hist);
    let txt = "==== 家庭网络自检报告 ====\n";
    txt += "时间：" + new Date().toLocaleString("zh-CN") + "\n";
    txt += "公网 IPv4：" + (S.ipv4 || "未获取") + "\n";
    txt += "公网 IPv6：" + (S.ipv6 || "未获取") + "\n";
    txt += "综合评分：" + (sc ? sc.score : "--") + "/100\n";
    if (sc) txt += `平均延迟 ${sc.avgAll.toFixed(0)}ms / 抖动 ${sc.jitAll.toFixed(0)}ms / 丢包 ${sc.lossAll.toFixed(0)}%\n`;
    if (sa.ok) txt += `同步抖动比例：${(sa.ratio * 100).toFixed(0)}%\n`;
    txt += "\n-- 各节点 --\n";
    EP.forEach(e => { const s = S.results[e.name]; if (s) txt += `${e.name}: avg ${s.avg.toFixed(0)} / min ${s.min.toFixed(0)} / max ${s.max.toFixed(0)} / jit ${s.jit.toFixed(0)} / loss ${s.loss.toFixed(0)}%\n`; });
    if (S.bb) txt += `\n-- Bufferbloat --\n空闲 ${S.bb.idle.toFixed(0)}ms / 满载 ${S.bb.loaded.toFixed(0)}ms / 增量 +${S.bb.delta.toFixed(0)}ms / 评级 ${S.bb.grade}\n`;
    if (S.rtc) txt += `\n-- WebRTC / NAT --\n公网IP ${S.rtc.pub.join(",") || "无"} / 内网IP ${S.rtc.loc.join(",") || "无"} / NAT ${S.rtc.nat}\n`;
    if (S.local) txt += `\n-- 本地服务 --\n开放 ${S.local.open.join(",") || "无"}${S.local.danger.length ? (" / 危险 " + S.local.danger.join(",")) : ""}\n`;
    if (S.sec) txt += `\n-- 安全姿态 --\nHTTPS安全上下文 ${S.sec.secure} / 混合内容 ${S.sec.mixed} / DoH可达 ${S.sec.doh}\n`;
    txt += "\n-- 修复建议（见网页诊断区）--\n";
    checklistItems.forEach(li => txt += "• " + li + "\n");
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "network-report-" + Date.now() + ".txt";
    a.click();
    log("已导出诊断报告");
  }, [computeScore, checklistItems, log]);

  /* ---------- 复制本页链接 ---------- */
  const copyPageLink = useCallback(() => {
    const link = SELF.url();
    const done = () => log("已复制本页链接（含全部参数）：" + link, "ok");
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = link; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { log("复制失败，请手动复制：" + link, "bad"); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, fallback);
    } else fallback();
  }, [log]);

  /* ---------- Clash 本地安全检测 ---------- */
  const clashItem = (addr, tagCls, tagText, detail) =>
    `<div class="clash-item"><div class="head"><span class="addr">${addr}</span><span class="tag ${tagCls}">${tagText}</span></div><div class="muted" style="margin-top:5px">${detail}</div></div>`;
  const runClashLocal = useCallback(async () => {
    if (clashRunning) return;
    const host = (clashHost || "127.0.0.1").trim();
    const ports = (clashPorts || "").split(",").map(s => s.trim()).filter(s => /^\d+$/.test(s));
    if (!ports.length) { setClashHtml('<span class="tag bad">请填写有效端口</span>'); return; }
    setClashRunning(true);
    setClashHtml('<div class="muted">正在检测 ' + host + ' 的 ' + ports.length + ' 个端口…</div>');
    let danger = 0, ok = 0, warn = 0, safe = 0, html = "";
    for (const port of ports) {
      const base = `http://${host}:${port}`;
      const r = await clashProbe(base);
      if (!r.reachable) {
        safe++;
        html += clashItem(base, "muted", "未暴露", r.err ? ("该地址无可用的 Clash 控制 API（" + r.err + "）") : "该地址无可用的 Clash 控制 API。");
      } else if (r.proxiesOpen) {
        danger++;
        html += clashItem(base, "bad", "高危·无密钥可读", "控制端口开放且未设 secret，本地任意网页可读取你的代理节点与连接信息" + (r.version ? ("（核心 " + r.version + "）") : "") + "。建议立即加固。");
      } else if (r.needsAuth) {
        ok++;
        html += clashItem(base, "ok", "已保护·需密钥", "控制端口开放但访问敏感接口需要 secret 鉴权，本地网页无法越权读取" + (r.version ? ("（核心 " + r.version + "）") : "") + "。配置较安全。");
      } else {
        warn++;
        html += clashItem(base, "warn", "需注意", "端口可达但敏感接口受限" + (r.version ? ("（核心 " + r.version + "）") : "") + "，请结合密钥设置确认。");
      }
    }
    let summary;
    if (danger > 0) summary = `<div class="row" style="margin-top:8px"><span>结论</span><b style="color:var(--bad)">🔴 ${danger} 个高危端口无密钥可读</b></div><div class="muted" style="margin-top:6px">请设置 secret、仅监听 127.0.0.1、换高位端口、升级核心版本。</div>`;
    else if (ok > 0) summary = `<div class="row" style="margin-top:8px"><span>结论</span><b style="color:var(--ok)">🟢 已设密钥保护</b></div>`;
    else summary = `<div class="row" style="margin-top:8px"><span>结论</span><b style="color:var(--ok)">🟢 未检测到开放控制 API</b></div>`;
    html += summary;
    if (safe === ports.length && location.protocol === "https:") {
      html += '<div class="muted" style="margin-top:6px">提示：当前为 HTTPS 页面，浏览器可能拦截了对 127.0.0.1 的明文请求。若你确认 Clash 正在运行却全部「未暴露」，请用 http:// 或 file:// 协议打开本页再测。</div>';
    }
    setClashHtml(html);
    const logCls = danger > 0 ? "bad" : "ok";
    log(`Clash 本地检测：高危 ${danger} / 需密钥 ${ok} / 需注意 ${warn} / 未暴露 ${safe}`, logCls);
    setClashRunning(false);
  }, [clashRunning, clashHost, clashPorts, log]);

  /* ---------- 挂载初始化 ---------- */
  useEffect(() => {
    renderConn();
    log("就绪。点击「开始全面检测」进行全面扫描，或开启「持续监控」长期盯梢网络抖动。");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- 渲染 ---------- */
  return (
    <div className="wrap">
      <h1>🏠 家庭网络自检与智能诊断</h1>
      <div className="sub">浏览器端全面检测：延迟 / 抖动 / 网速 / DNS / IPv6，并自动定位瓶颈、给出可执行的修复步骤。</div>

      <div className="topbar">
        <div className="score">
          <div className="ring" style={{ "--v": score === null ? 0 : score, "--ringc": ringColor }}>
            <b>{score === null ? "--" : score}</b>
          </div>
          <div>
            <div className="verdict" style={{ color: ringColor }}>{verdict}</div>
            <div className="lbl">综合健康评分（0–100）</div>
          </div>
        </div>
        <div className="conn" id="connBox">
          <div className="it">连接：<b>{cType}</b></div>
          <div className="it">公网 IPv4：<b>{ipv4Disp}</b></div>
          <div className="it">公网 IPv6：<b>{ipv6Disp}</b></div>
        </div>
      </div>

      <div className="btns">
        <button className="primary" id="btnRun" disabled={running} onClick={fullCheck}>{runLabel}</button>
        <button id="btnMonitor" className={monitor ? "on" : ""} onClick={toggleMonitor}>🔁 持续监控：{monitor ? "开 (每60s)" : "关"}</button>
        <button id="btnCache" onClick={clearCache}>🧹 清理浏览器缓存</button>
        <button id="btnReport" onClick={exportReport}>📄 导出诊断报告</button>
        <button id="btnCopyLink" onClick={copyPageLink}>🔗 复制本页链接</button>
      </div>

      <div className="grid">
        <div className="card">
          <h2><span className="dot"></span>延迟与抖动（多节点并行探测）</h2>
          <canvas id="chart" ref={canvasRef}></canvas>
          <table id="latTable">
            <thead><tr><th>节点</th><th>平均</th><th>最小</th><th>最大</th><th>抖动</th><th>丢包</th></tr></thead>
            <tbody dangerouslySetInnerHTML={{ __html: latRowsHtml }}></tbody>
          </table>
          <div id="syncVerdict" className="muted" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: syncVerdictHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>网速测试</h2>
          <div className="gauge">
            <div><div className="gbig" dangerouslySetInnerHTML={{ __html: dlDisp }}></div><div className="muted">下载</div></div>
            <div><div className="gbig" dangerouslySetInnerHTML={{ __html: ulDisp }}></div><div className="muted">上传</div></div>
          </div>
          <div className="bar"><i style={{ width: dlBar + "%" }}></i></div>
          <div className="muted" id="speedNote" style={{ marginTop: 8 }}>下载/上传通过 Cloudflare 测速节点（CORS）。若所在网络访问不畅会显示不可用，属正常。</div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>DNS 解析</h2>
          <div id="dnsBox" dangerouslySetInnerHTML={{ __html: dnsHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>IPv6 支持</h2>
          <div id="ipv6Box" dangerouslySetInnerHTML={{ __html: ipv6Html }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>饱和测试 / Bufferbloat</h2>
          <div id="bbBox" dangerouslySetInnerHTML={{ __html: bbHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>WebRTC 隐私 / NAT</h2>
          <div id="rtcBox" dangerouslySetInnerHTML={{ __html: rtcHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>本地服务暴露扫描</h2>
          <div id="localBox" dangerouslySetInnerHTML={{ __html: localHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>安全 / 加密姿态</h2>
          <div id="secBox" dangerouslySetInnerHTML={{ __html: secHtml }}></div>
        </div>

        <div className="card">
          <h2><span className="dot"></span>Clash 本地安全检测</h2>
          <div id="clashLocalBox" dangerouslySetInnerHTML={{ __html: clashHtml }}></div>
          <div className="field"><span>控制地址</span><input id="clashHost" value={clashHost} onChange={e => setClashHost(e.target.value)} /></div>
          <div className="field"><span>端口</span><input id="clashPorts" value={clashPorts} onChange={e => setClashPorts(e.target.value)} /></div>
          <button id="btnClashLocal" className="primary" style={{ marginTop: 10 }} disabled={clashRunning} onClick={runClashLocal}>检测本机 Clash</button>
        </div>

        <div className="card">
          <h2><span className="dot"></span>Clash 全球暴露态势</h2>
          <div className="muted">通过公开、合法的互联网资产搜索引擎查询全球暴露的 Clash / Mihomo 控制服务，仅用于安全研究与自身资产排查。本工具<b>不主动扫描、不触碰任何他人主机</b>。</div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <a className="extlink" id="linkFofa" href={FOFA_HREF} target="_blank" rel="noopener"><b>FOFA</b> · body="hello:mihomo/clash"</a>
            <a className="extlink" id="linkShodan" href={SHODAN_HREF} target="_blank" rel="noopener"><b>Shodan</b> · port 9090 / 9097</a>
            <a className="extlink" id="linkZoom" href={ZOOMEYE_HREF} target="_blank" rel="noopener"><b>ZoomEye</b> · Clash / Mihomo</a>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>若你的 Clash 开启了 allow-lan 并把控制端口暴露到局域网/公网，可在左侧「本地检测」把地址改为你的局域网 IP 复测。</div>
        </div>

        <div className="card diag" style={{ gridColumn: "1 / -1" }}>
          <h2><span className="dot"></span>智能诊断与自主处置</h2>
          <div id="diagBox" dangerouslySetInnerHTML={{ __html: diagHtml }}></div>
          <ul className="checklist" id="checklist" style={{ marginTop: 12 }}>
            {checklistItems.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2><span className="dot"></span>实时日志 / 监控</h2>
          <div className="log" id="log" ref={logRef}>
            {logLines.map((l, i) => (
              <div key={i} style={l.cls ? { color: logColor(l.cls) } : undefined}><b>[{l.t}]</b> {l.msg}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
