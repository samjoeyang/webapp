# 本地网页/小工具交付前验证（macOS）

适用：做完一个本地网页项目（`index.html` + 本地服务），需要**亲眼确认**渲染与交互都对，
而不是靠读代码猜。核心原则：**能用真实浏览器跑一遍就别只做静态代码审查**——
尤其是 SVG/Canvas 绘制、坐标变换、导出图片这类「看才知道对不对」的东西。

## 零、先探测环境（别急着装东西）

```bash
command -v agent-browser; ls ~/Library/Caches/ms-playwright 2>/dev/null; command -v qlmanage
ls /Applications | grep -iE "chrome|edge|brave|chromium|firefox"
```

- 有 `agent-browser`：按其文档走，最省事。
- 没有自动化环境但**装了 Chrome**：走下面两条路（推荐，无需下载几百 MB）。
- `qlmanage` 能渲染 SVG 缩略图，但在受限会话里会报 `sandbox initialization failed`，别指望它。

## 一、快速看一眼：无头 Chrome 截图

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=old --disable-gpu --no-sandbox --disable-software-rasterizer \
  --use-angle=swiftshader --no-first-run --hide-scrollbars \
  --virtual-time-budget=15000 --window-size=1280,1800 \
  --screenshot=/tmp/shot.png "http://localhost:PORT/"
```

- **必须用 `--headless=old`**。`--headless=new` 在受限会话里常因 GPU 进程崩溃
  直接 `FATAL: GPU process isn't usable. Goodbye.`，拿不到图。
- `--virtual-time-budget=15000` 给异步加载留时间；有挂起网络请求时 Chrome 会暂停虚拟时间，
  对「等接口返回」的页面也够用。
- 需要页面底部内容：加高 `--window-size`，或改用 playwright 的 `fullPage: true`。
- 截图后用 Read 工具直接看图确认。

## 二、抓 DOM 终态（定位「为什么没渲染」）

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=old --disable-gpu --no-sandbox --virtual-time-budget=15000 \
  --dump-dom "http://localhost:PORT/" 2>/dev/null > dom.html
```

再针对性 grep：元素 class 是否还带 `hidden`、列表项数量、状态文案、是否有残留报错提示。
适合确认「接口通没通」「循环渲染了几个节点」，输出大但可 grep。

## 三、交互验证：playwright-core + 本机 Chrome（不下载浏览器）

```bash
cd /Users/$USER/.workbuddy/binaries/node/workspace && npm install playwright-core --no-audit --no-fund
```

```js
import { chromium } from 'playwright-core';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--use-angle=swiftshader']
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));      // 捕获静默 JS 异常
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('requestfailed', r => errs.push('REQFAIL: ' + r.url()));      // 顺带发现 favicon 404
```

### 必踩的坑

- **ESM 不认 `NODE_PATH`**：脚本要么放在 node_modules 所在目录运行，要么在项目根建符号链接：
  ```bash
  ln -s /Users/$USER/.workbuddy/binaries/node/workspace/node_modules ./node_modules
  echo "node_modules/" >> .gitignore     # 别忘了
  ```
- **等异步结果不要用固定 `sleep`**——两个方向都会错，且都伪装成「页面坏了」：
  等太短 → 读到空串/「加载中…」，误判渲染失败；条件太松 → 容器里的**执行中占位文案**
  被当成结果立即返回。正确做法是**轮询 + 结果特征词**（正则匹配「泄漏 N 处」「共 N 项」）：
  ```js
  async function waitForResult(sel, timeoutMs, pattern) {
    const t0 = Date.now(); let last = '';
    while (Date.now() - t0 < timeoutMs) {
      last = await page.locator(sel).innerText().catch(() => '');
      if (pattern.test(last)) return last;
      await page.waitForTimeout(1200);
    }
    return last;   // 超时也返回，交给上层判定
  }
  ```
- **取 DOM 别用「第一个匹配」**：页面有多个同类容器时会取错对象。从已知锚点向上找：
  `document.getElementById('auditRows').closest('.tablewrap')`。
- **页面内 `id` 不得重复，且 JS 引用的 `id` 必须存在**——建议直接做成结构自检。
  真实案例：顶栏用户区和某张卡片都写了 `id="meBox"`，`getElementById` 只返回第一个，
  卡片渲染时把顶栏整块 `innerHTML` 覆盖掉，**退出按钮凭空消失**；截图里只表现为「某个区块没了」。
  ```js
  const audit = await page.evaluate(() => {
    const live = [...document.querySelectorAll('[id]')].map((el) => el.id);
    const c = new Map(); live.forEach((id) => c.set(id, (c.get(id) || 0) + 1));
    const dup = [...new Set(live.filter((id) => c.get(id) > 1))];
    // 引用是否存在要对**整份源码**算：弹窗表单字段是 JS 模板生成的，只看当前 DOM 会报假缺失
    const src = document.documentElement.outerHTML;
    const declared = new Set([...src.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
    const refs = [...new Set([...src.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
    return { dup, missing: refs.filter((id) => !declared.has(id)) };
  });
  ```
  口径：**重复**只在当前 DOM 里算（那才是真 bug）；**引用是否存在**要连 `<script>` 里的模板串一起算。
- **长表要限高滚动**：几百行的表格会把页面撑到几千甚至八千像素，表头滚走、截图失真。
  给容器 `max-height + overflow:auto`，表头 `position:sticky`。
- 触发 SVG/DOM 事件用 `element.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
  比 `page.click` 更可靠（避免坐标命中/遮挡问题）。
- 每次点击会重建 DOM，要重新 `querySelector`。
- 验证下载：`acceptDownloads: true` + `Promise.all([page.waitForEvent('download'), page.click(btn)])`
  → `download.saveAs(path)` → **Read 这个产物看效果**。导出类功能必须真的看一眼产物。
- 元素级截图：`page.locator('.main').screenshot({ path })`，比全页更清楚。
- 结束后必须 `await browser.close()`。

## 四、登录态页面：不要用 `httpCredentials`，要真的登一次

`newContext({ httpCredentials })` 只响应服务器主动发起的 401 Basic 挑战。
一旦前端改成「未登录 → 302 跳转登录页 + 表单 POST + 会话 cookie」，它完全不生效，
脚本会停在登录页，后面每条断言都退化成「元素找不到」。

正确做法是在脚本开头**真的走一次表单登录**，并把结果前置断言：

```js
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const landPath = new URL(page.url()).pathname;
if (landPath !== '/login') errs.push('LOGIN_PAGE_MISSING: 期望跳到登录页，实际 ' + landPath);

await page.fill('#loginId', USER);
await page.fill('#loginPw', PASS);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
  page.dispatchEvent('#loginBtn', 'click'),
]);

const cookieNames = (await ctx.cookies()).map((c) => `${c.name}${c.httpOnly ? '(HttpOnly)' : ''}`);
if (!cookieNames.some((n) => n.startsWith('ipvault_session'))) errs.push('NO_SESSION_COOKIE');
```

三条经验：
- **把「会话是否真的生效」放在最前面验**（头部用户区是否显示、退出按钮是否存在）。
  这一步失败时，后面的失败都是它的衍生品。
- 登录页的注册表单顺手验字段完整性（不真提交，免得污染账号库）。
- 结尾加**退出登录**回归：点退出 → 回到 `/login` → 残留会话 cookie 必须为 0。

## 五、脚本健壮性：一条断言失败不能吞掉整轮诊断

回归脚本最容易踩的坑不是断言写错，而是**中途抛异常导致整轮结果丢失**——
脚本崩在最后一步，前面 30 条诊断一条都打不出来，只看到 `Timeout 30000ms exceeded`。

- 易失败的步骤改成「**可失败不中断**」：先 `count()` 探存在性，不存在就 `errs.push()` +
  `page.screenshot()` 留现场，然后继续。
- 报告（步骤清单 + 报错清单）**始终输出**，即使中途异常。
- 断言失败与页面报错**合并进退出码**，交付前跑一次就能判定。

## 六、定位「catch 吞掉的静默异常」

现象：界面正常了一半、或明明有数据却提示「加载失败」。原因常是渲染中途抛错被 `try/catch` 吞了。

```js
} catch (err) {
  console.error(err);
  try { document.title = 'ERR:' + (err && err.message ? err.message : String(err)); } catch (e) {}  // 临时加的
  ...
}
```

然后用 `--dump-dom` 抓 `<title>` 就能拿到真实错误。拿到后**务必移除这行临时代码**。
高频真凶：DOM 别名映射写错（HTML 里 id 是 `gameMsg`，JS 里写 `el.msg`）→ `Cannot set properties of undefined`。

## 七、执行环境注意

- 用 Bash 写脚本时**不要用 heredoc 传含 `${...}` 的 JS**：外层 shell 会先展开导致 `Bad substitution`。
  改用 Write 工具直接写文件。
- 本地服务用 Bash 的 `run_in_background: true` 启动，不要 `nohup`（会话结束会被回收）。

## 八、截图留档：小心「两张不同名的图 md5 一样」

`fullPage` 截图拍整页。若两次截图之间页面**没有真正变化**（点了「查询」但条件没变），
两张图会**逐字节相同**——归档里出现两张 md5 相同的「不同页面」截图，只会让人怀疑抓错了对象。

这类重复图是**信号**：要么**断言根本没生效**（点了没反应，等于漏测），
要么**截错了对象**（该截卡片却截了整页）。

- 交付前核对去重：`md5 -q *.png`，或按文件大小分桶（大小完全相同的高度可疑）。
- 若两个截图点本就同屏，第二次改截**元素级**截图：
  ```js
  const card = page.locator('.card')
    .filter({ has: page.locator('h2', { hasText: '审计日志' }) }).first();
  try { await card.screenshot({ path: `${OUT}/07-审计日志.png` }); }
  catch { await shot('07-审计日志', '审计日志（含被拒记录）'); }   // 退回整页，别让截图拖垮回归
  ```
- 反之，「该有变化的两张图却完全一样」也常用于**证明某处没生效**（如切换维度选择器后行数不变）。

## 九、轮询「终态」：占位文案里绝不能含终态特征词

异步步骤通常先在容器里放一句占位文案。若脚本用**特征词**轮询，而占位文案恰好包含那个词，
脚本会**把「进行中」当成「已完成」**——看起来像功能坏了，其实是测试坏了。

真实踩例：占位文案写「正在读取标题与开头，识别**候选**标签…」，脚本等的是 `候选`，
于是立刻命中、chips 数 0、白跑两轮。

两条都要做：
1. **收窄等待条件**：优先等**结构性特征**（元素/属性），而不是文案。
   ```js
   const n = await page.locator('#panel button[data-tag]').count();
   if (n > 0 || /没有识别到|未能识别|无法解析/.test(txt)) return txt;
   ```
2. **收窄占位文案**：让占位与终态**不共享任何特征词**，用「正在…处理中…」式措辞。

通用规则：**等待条件必须落在「终态」，不能落在「过程」。**

## 十、`esc()` 挡不住 `onclick` 里的字符串逃逸

常见写法 `onclick="fn('${esc(x)}')"`。`esc()` 只做 HTML 转义，管不了 JS 引号：
浏览器会先把属性值里的 `&#39;` **还原成真引号**，再当 JS 源码解析 → 数据里一个单引号就能逃出字符串。

要转两层：

```js
const es = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsq = (s) => es(String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
```

排查入口：`grep -n "onclick=\"[a-zA-Z]*('\${esc" *.html`，命中的都换成 `jsq`。
多行模板串里 grep 会漏（属性值被换行断开），更稳的是按属性解析：

```python
pat = re.compile(r'on(?:click|change)="([^"]*)"')
hits = [b for b in pat.findall(src) if '${esc(' in b]   # 命中即需改 jsq
```

这类隐患多来自历史代码，**发现就顺手修，别只修自己新写的那几处**。

## 十一、改一堆重复文案：一次脚本 + 计数断言，别并发编辑同一文件

真实事故：在 2500 行的 `index.html` 里改 9 处零散文案，把 5 个编辑调用**并发**发出去——
报「成功」的只有一部分。并发编辑同一文件会互相覆盖：每个调用都基于自己读到的旧内容写回，
后写的把先写的冲掉，而工具仍报成功。表现极具迷惑性：grep 复查发现「改过的行还是旧文案」。

两条硬规则：
1. **同一文件绝不并发编辑。** 要批量改就写脚本一次改完，并对每处替换断言 `count(old) == 1`
   （不唯一匹配就整体失败、不落盘）：
   ```python
   for old, new in pairs:
       if s.count(old) != 1: fail(old)      # 宁可报错，不要改错地方
       s = s.replace(old, new, 1)
   io.open(p, 'w', encoding='utf-8').write(s)   # 全部通过才写
   ```
2. **改完必须复查**（`grep` 清零 + `node --check` 抽 `<script>` 验语法）。
   只信编辑器的「成功」提示，会带着半个改动交付。

## 十二、断言写完先证明它**会失败**

修好一个静默 bug 后，把旧代码**临时注入回去**，确认新断言确实变红，再恢复。
否则你无法区分「断言通过了」与「断言根本没执行/恒真」。

```bash
python - <<'PY'
s = open(p, encoding='utf-8').read()
s = s.replace('rec["node_id"]', 'rec["org_node_id"]', 1)   # 还原旧 bug
open(p, 'w', encoding='utf-8').write(s)
PY
<跑验证脚本>   # 期望：恰好那一条 FAIL
```

尤其要覆盖**被 `except` 吞掉的分支**：这类代码失败时的表现是「一切正常，只是功能没生效」。

## 十三、两个高频误判断言

1. **`innerText` 取不到 `title` 属性，也取不到兄弟元素。**
   断言「表头有两列」时读的是 `<tbody>`——表头在 `<thead>` 里，根本不在同一元素内，断言恒假。
   ```js
   const thead = await card.locator('thead').innerText();
   const tip = await cell.getAttribute('title');
   ```
   口径：**断言目标的 DOM 归属要和取值元素一致**，不放心就用 `closest()` 往上选一层。

2. **回归脚本必须自带清理，否则第二次跑就红。**
   往「三级树」里建节点的脚本，第二次跑会因「同级重名被拒」失败——看起来像功能坏了，其实是数据没打扫。
   ```js
   const items = (await api('/api/nodes')).items.sort((a,b)=>b.depth-a.depth);
   for (const n of items) await del('/api/nodes/' + n.node_id);
   ```
   判据：**同一脚本连跑两次，第二次结果必须与第一次完全一致**（含断言条数）。

3. **登录态断言要区分「凭据 cookie」与「提示 cookie」。**
   退出后 `session` cookie 必须清空，但「上次登录的公司标识」这类**非凭据**提示 cookie
   往往按设计保留。混成一个断言（「所有 cookie 都要没」）会得到永远为红的假缺陷。
