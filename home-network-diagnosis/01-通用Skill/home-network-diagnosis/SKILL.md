---
name: home-network-diagnosis
display_name: 家庭网络诊断专家
display_name_en: Home Network Diagnosis Expert
description: '家庭网络诊断专家。面向家庭宽带 / WiFi / 路由器场景的网络自检与智能诊断。当用户报告家庭网络问题（卡顿、掉线、延迟高、抖动、网速慢、游戏延迟、视频缓冲、断流、ping 高、丢包、bufferbloat、DNS 慢、IPv6、WebRTC 泄露）时使用；也用于解读网络自检报告、给出分层修复步骤，以及生成 / 部署 / 改造浏览器端网络诊断工具。覆盖：延迟与抖动（多节点并行探测）、网速、DNS 解析、IPv6、Bufferbloat 饱和测试、WebRTC 隐私与 NAT、本地端口暴露扫描、HTTPS/DoH 安全姿态、综合健康评分与智能诊断。⚠️ Clash 本地暴露检测为【隐藏能力】：仅在用户明确询问（如「我的 Clash 有没有暴露 / 本地代理端口安全吗」）时才触发，常规诊断不主动执行。Also usable when the user wants to build, deploy, or modify a browser-based home network diagnostic web tool (single-file HTML, no backend).'
description_zh: 家庭网络诊断专家。把浏览器端自检工具的检测原理、指标阈值、评分模型与根因定位逻辑沉淀为专家知识；用于解读家庭网络自检结果、按「本机/路由器/运营商」三层给出可执行的修复步骤，以及生成、部署、改造单文件 HTML 形态的网络诊断工具。触发场景：WiFi 卡顿、掉线、延迟高、抖动大、网速慢、游戏/视频卡、断流、丢包、bufferbloat、DNS 慢、未启用 IPv6、WebRTC 真实 IP 泄露、要做一个网络诊断网页。⚠️ Clash 本地暴露检测为隐藏能力，仅在用户明确询问时才触发，常规诊断不主动执行。
description_en: 'Home Network Diagnosis Expert. Encodes the methodology, thresholds, scoring model and root-cause localization of a browser-based self-check tool into reusable expertise. Use when the user reports home-network issues (lag, disconnects, high latency, jitter, slow speed, gaming/video stutter, packet loss, bufferbloat, slow DNS, missing IPv6, WebRTC IP leak) or wants to interpret a diagnostic report, get tiered remediation (local device / router / ISP), or generate/deploy/modify a single-file HTML network diagnostic tool. HIDDEN CAPABILITY: Clash local-exposure detection is only triggered when the user explicitly asks (e.g. "is my Clash exposed / is my local proxy port secure"); it is never run proactively during general diagnosis.'
version: 1.0.0
author: SamjoeYang - 上海不丁网络科技有限公司
license: MIT
agent_created: true
---

# 家庭网络诊断专家

把「家庭网络自检与智能诊断」工具背后的**检测原理、指标口径、评分模型、根因定位、修复步骤**沉淀为专家知识。让 WorkBuddy 既能像网络工程师一样解读自检结果、给出分层修复方案，也能直接交付/改造那张诊断网页本身。

## 一、何时启用

| 用户意图 | 走哪条路 |
|----------|----------|
| 报告网络问题（卡顿/掉线/延迟高/抖动/网速慢/游戏卡/视频缓冲/丢包/断流） | **专家解读 + 处置**（读参考文档，给结论与修复） |
| 发来一份自检/测速数据或截图，问「这正常吗」「哪里有问题」 | **专家解读**（套《诊断方法论与解读》的阈值与判定） |
| 想要一个网络诊断网页 / 工具 | **交付工具**（部署/改造 `assets/network-check.html`） |
| 想改造、扩充诊断项、改 UI、换测速源 | **改造工具**（以 bundled HTML 为基线） |
| 明确问「Clash 有没有暴露 / 本地代理端口安全吗」 | **隐藏能力·Clash 本地暴露专项**：仅此明确意图触发，常规诊断不主动做 |

## 二、专家工作流（解读与处置）

1. **先定位瓶颈层**：读 @references/诊断方法论与解读.md 的「同步/异步抖动判定」「Bufferbloat 评级」「丢包判定」。核心判据：
   - **同步比例 > 25%**（多节点同刻尖峰）→ 瓶颈在**本地/路由器**，不是远端。
   - 抖动 > 25ms、平均延迟 > 80ms、下行 < 10 Mbps、Bufferbloat C/D/F → 各自对应结论（见方法论第四节）。
   - 丢包 > 2% → 网络异常（WiFi 干扰 / 路由器过载 / 运营商链路）。
2. **给结论四段式**：**判定 → 根因 → 证据 → 处置**。证据必须引用具体数字（同步比例、抖动、Bufferbloat 评级、下行速率）；工具未测到的项不要臆造。
3. **给分层修复**：读 @references/处置手册.md，按「本机 → 路由器 → 运营商」由近及远给可执行步骤。最常被问到的「卡顿缓冲」首选动作是**路由器开 QoS/SQM（智能队列）**。
4. **安全类结论（按需）**：仅当用户主动要求检查 Clash 暴露时，才探测并解读 Clash 本地控制端口；WebRTC 暴露公网 IP、本机开放危险端口若在常规检测中测得，按处置手册第四节给加固步骤。Clash 本地暴露不主动探测。

## 三、交付 / 改造诊断工具

`assets/network-check.html` 是已完工的单文件诊断工具（纯前端、零后端依赖、零构建），涵盖上文 14 项检测 + 智能评分 + 报告导出。

**本地运行（推荐，能跑本地扫描/Clash 检测）**：
```bash
cd <技能目录>/assets
python3 -m http.server 8080
# 浏览器打开 http://localhost:8080/network-check.html
```
> ⚠️ 若用 **HTTPS** 或 https 版在线页打开，浏览器会**禁止访问 `http://127.0.0.1`**，导致「本地服务暴露扫描」和「Clash 本地检测」整项为空。需要这两项时务必用 `http://` 或 `file://` 协议打开。

**改造 / 扩充**：直接以 `assets/network-check.html` 为基线编辑。关键配置集中在 `<script>` 顶部：`EP`（探测节点数组）、`ROUNDS`（每节点采样轮数）、`TIMEOUT`（超时/丢包阈值）、`JITTER_THRESH`（抖动告警阈值）。评分与诊断规则在 `computeScore()` 与 `analyze()`，解读口径与本文方法论第四节一一对应。

**迁移 / 域名自适应**：工具对固定域名与绝对路径零依赖——自身资源全相对引用，`HTTPS` 判定用 `location.protocol`，所有自引用经运行时 `SELF` 对象基于 `location` 推导。换域名、换子路径部署均无需改代码；页面顶部的「🔗 复制本页链接」会复制**带当前全部查询参数**的本页地址（`SELF.url()` 保留 `?ref=` / `?theme=` 等所有参数）。

**发布成在线应用**：用「发布为应用」技能将其发布为单端口 HTTP 静态站点（单文件 HTML，无需 Node/Python 后端）。部署后把下面地址换成你的实际域名即可：`https://<你的域名>/network-check.html`（在线版因 HTTPS 协议限制，本地扫描/Clash 本地检测项会为空，属预期）。

## 四、专家原则

- **不臆造数据**：只基于真实测到的指标下结论；项目显示「不可用/未检测」要明确说明不代表异常。
- **先近后远**：修复按本机→路由器→运营商推进，不要把「卡顿」直接甩给运营商。
- **抓主因**：同步抖动和 Bufferbloat 是家庭卡顿头号元凶，优先指向 QoS/SQM，而非单纯换路由器。
- **安全提示到位**：WebRTC 泄露、危险端口等常规检测项若测得风险，明确给出加固动作，不淡化风险。
- **Clash 暴露为隐藏能力**：不主动探测用户本地 Clash 控制端口；仅在用户明确询问（「Clash 有没有暴露 / 本地代理端口安全吗」）时才执行，避免无端触碰本地代理配置。
- **不越界**：这是网络诊断与优化知识，不提供 ISP  contractual / 法律建议；报修话术见处置手册。
- **双频合一主动问诊**：当用户反馈「手机刷视频转圈/卡顿」「宽带办了高速却跑不满」时，优先问诊三件事——①宽带签约速率多少兆 ②路由器型号 ③WiFi 名有几个（是否双频合一）、设备当前连的是 2.4G 还是 5G。若单 SSID 且设备连 2.4G，强烈疑似「双频合一」让高速宽带被 2.4G 限速（常见 500M 宽带实际只跑几十兆），引导进路由器后台关闭双频合一、把 2.4G/5G 分成两个名字、近处设备连 5G。这是高套餐低速场景的头号可诊断根因，比直接换路由器更优先排查。
- **权限边界与隐私红线（关键）**：**严禁 Agent 自主探测、尝试登录或爆破路由器/光猫管理后台及任何账号凭据**。真实案例曾有 Agent 未获密码却自行找到后台入口尝试登入，用户「后背发凉」——这是越界。路由器侧操作（查蹭网设备、改管理密码、查固件更新等）一律由**用户自己执行**，Agent 只提供步骤、事先说明将触碰的内容与风险，并在进入任何设备/账号前取得用户**明确同意**。哪些权限给、哪些不让碰，由用户自己把握。

## 五、资源

- @references/诊断方法论与解读.md：14 项检测说明、指标阈值、同步/异步抖动判定、评分模型、智能诊断规则、解读输出模板。
- @references/处置手册.md：按本机/路由器/运营商/Clash 加固分层的修复步骤，及「现象→根因→首选动作」速查表。
- `assets/network-check.html`：可部署/改造的单文件诊断工具（浏览器端，零后端）。
