// 门户数据：网页应用、桌面端应用、Skills、API 接口。
// 注意：链接统一用相对路径（base: './'），保证部署到任意子路径都能正常工作。

export const APPS = [
  { ico:"⚖️", name:"司法资源工具", desc:"律师·律所·公证·司法鉴定·法律援助·人民调解·仲裁·司法所·商标分类·案由查询·诉讼费测算一站式查询。", link:"https://legaldata.zhenzhidaole.com/", status:"live", label:"已上线" },
  { ico:"🧭", name:"旅途 · 旅游行程规划", desc:"多行程管理、配色切换、ZIP/JSON 备份导入导出、PDF 行程单生成。", link:"travel-planner/", status:"open", label:"可直接打开" },
  { ico:"✅", name:"会议签到系统", desc:"创建会议、AI 粘贴填充表单（MIF v1）、扫码/手写签名签到、日历导出、管理口令；数据云端存储，多设备实时同步。", link:"meeting-checkin/", status:"open", label:"可直接打开" },
  { ico:"🏠", name:"家庭网络诊断专家", desc:"浏览器端全面检测：延迟/抖动/网速/DNS/IPv6，自动定位瓶颈并给出可执行修复步骤，支持导出诊断报告。", link:"home-network-diagnosis/", status:"open", label:"可直接打开" },
  { ico:"📊", name:"Excel 处理工具", desc:"在线读取、处理与转换 Excel 表格数据。", link:"https://excelprocessor.tools.zhenzhidaole.com/", status:"live", label:"已上线" },
  { ico:"🎬", name:"视频播放器", desc:"网页视频播放器，支持常用播放控制。", link:"https://player.zhenzhidaole.com/", status:"live", label:"已上线" },
  { ico:"🍜", name:"美食评价生成器", desc:"生成可分享的美食评价卡片/页面。", link:"https://share.pages.ladycao.com/", status:"live", label:"已上线" },
  { ico:"📚", name:"电子书阅读器", desc:"在线电子书阅读，支持多格式与阅读设置。", link:"https://ebookreader.zhenzhidaole.com/", status:"live", label:"已上线" },
  { ico:"🧸", name:"KidKit 学习小工具合集", desc:"儿童学习工具合集：认识时钟与日历、汉字笔顺动画与笔顺挑战、字母打字学英语（分类词库+语音朗读+指法提示）、识典古籍检索等。", link:"https://kidkit.ladycao.com/", status:"live", label:"已上线" },
  { ico:"🔗", name:"短链生成器", desc:"在线 URL 短链接生成工具：输入长网址一键生成安全短链接，便于分享与传播。", link:"https://link.0net.in/", status:"live", label:"已上线" },
  { ico:"🗄️", name:"KV 管理后台", desc:"Cloudflare KV 存储管理后台：使用 Access Token 登录，集中管理 KV 实例与键值数据。", link:"https://kvadmin.unoecp.zhenzhidaole.com/", status:"live", label:"已上线" }
];

// 桌面端应用：原生客户端，官网提供各平台安装包下载
export const DESKTOP_APPS = [
  {
    ico:"🎛️", name:"SwitchKit", desc:"macOS 菜单栏快捷开关 + 系统资源释放工具：一键切换深色模式、隐藏桌面图标/Dock、阻止睡眠、清空废纸篓、屏幕清洁与台前调度；释放内存、刷新 DNS、按白名单预览清理用户缓存；蓝牙设备一键连接/断开；DeepSeek、Kimi、智谱 GLM、OpenRouter 等十余个平台的大模型余额实时查看；还能像 Bartender 一样收纳菜单栏图标。无 Dock 图标、默认不联网不上报，支持在线更新。",
    link:"https://switchkit.zhenzhidaole.com/", status:"desktop", label:"桌面端",
    platforms:["macOS 12.7.6+","Apple Silicon / Intel"]
  },
  {
    ico:"💬", name:"unobox", desc:"Telegram 风格的跨平台私有即时通讯客户端：内置 OpenAI / Claude / Gemini / DeepSeek / Qwen / 火山引擎等 9 种 AI 模型（流式输出、思考过程可视化），EPUB 有声书阅读与 WAV/MP3 音频导出，Word/Excel/PDF/Markdown 全格式预览，自定义视频播放器，内置浏览器与三层视频嗅探。本地 SQLite / 自建 WebSocket / Matrix 三种协议可选，均支持端到端加密，数据主权由你掌控。",
    link:"https://unobox.zhenzhidaole.com/", status:"desktop", label:"桌面端",
    platforms:["Windows","macOS 12.7.6+","Linux"]
  },
  {
    ico:"📝", name:"UNOEditor", desc:"Markdown 排版主题编辑器：左边写稿、右边实时预览，11 套内置排版主题一键切换，字号/行高/强调色滑杆即调即生效；大纲自动生成并跟随光标，多文档本地保存；一键复制到公众号（计算样式递归内联、根节点转 section），或导出样式内嵌 HTML、Markdown、打印/PDF；纯本地运行零上传，断网可用，附 Tauri 2 桌面壳，中英界面一键切换。",
    link:"https://unoeditor.zhenzhidaole.com/", status:"desktop", label:"桌面端",
    platforms:["macOS 12.7.6+","Windows","Linux"]
  },
  {
    ico:"📄", name:"PDF Studio", desc:"本地优先的桌面 PDF 工作台：合并、重排、拆分、旋转、批注签名、水印、文字提取与离线中英文 OCR、身份证排版、压缩优化等日常文档处理；所有处理都在本机完成，离线也能用，文档不上传任何服务器。",
    link:"https://pdfstudio.zhenzhidaole.com/", status:"desktop", label:"桌面端",
    platforms:["Windows","macOS 12.7.6+","Linux"]
  }
];

export const SKILLS = [
  {
    ico:"💬", name:"微信附件整理（合规版）", slug:"wechat-attachment-organizer",
    desc:"整理 PC 端微信（Windows/macOS/Linux，3.x 与 4.x 自动探测）聊天中的附件（文档/图片/视频），按类型或客户分类、去重后复制到指定目录，并可导入资料库全文检索。仅读取本地文件，不解密聊天数据库。",
    tags:["微信","文件整理","去重"]
  },
  {
    ico:"🔍", name:"文档审校", slug:"doc-proofreader",
    desc:"通读中文文档，挑四类问题：错别字、时间矛盾、数字口径、缺失条件；按严重程度汇总最关键的最多 5 项，每条给定位、问题说明与修改建议。发布/发送前快速把关。",
    tags:["审校","校对","挑错"]
  },
  {
    ico:"📋", name:"研究依据核对", slug:"research-evidence-check",
    desc:"提交前逐条核对「结论↔依据」是否对应、统计与定义口径是否一致，并对缺依据项做标准标注（〔缺依据〕/〔弱对应〕/〔口径不一致〕/〔不对应〕）。",
    tags:["依据核对","论证核查","口径"]
  },
  {
    ico:"📷", name:"反偷拍扫描", slug:"hidden-camera-scanner",
    desc:"酒店/租房/会议室反偷拍排查五阶段法：arp-scan/nmap 扫局域网识别监控厂商与 RTSP/ONVIF 端口，bleak 识别 AirTag 等追踪器（含地址轮换分析），MVT 手机检查指引，手电人工排查清单，最终生成分级风险报告。跨平台（macOS/Windows/Linux/Android/iOS）先体检再执行，不支持的功能给替代方案；合规三不原则：不登录设备、不利用漏洞、不访问视频流。",
    tags:["反偷拍","网络安全","蓝牙追踪","风险报告"]
  },
  {
    ico:"⚖️", name:"诉讼费用计算器", slug:"litigation-fee-calculator",
    desc:"全面测算与诉讼相关的全部费用：法院法定诉讼费（案件受理费+申请费，覆盖财产/离婚/人格权/知识产权/劳动/行政/管辖异议及减半、地方标准）、律师费、财产保全保险费、公证费、鉴定费、评估费、拍卖费、公告费、翻译费、差旅费，区分「法定·精确」与「市场化·估算」两层，并给出合计。依据《诉讼费用交纳办法》（国务院令第481号）及公证服务价格指导意见。",
    tags:["诉讼费","维权成本","法院收费","律师费","公证费"]
  },
  {
    ico:"🧹", name:"macOS 清理与开发环境维护", slug:"macos-system-cleaner",
    desc:"跨 macOS 版本的清理与运维工具箱，共 36 个清理类目。①清理：缓存/日志/邮件垃圾/Xcode 派生数据/iOS 备份/容器与浏览器缓存/Homebrew/字体缓存/应用支持目录缓存/大文件旧文件，npm/Python/Rust/Ruby/Maven/Gradle/NuGet 等各语言生态缓存与虚拟环境，Docker 构建缓存与未使用镜像与已停止容器，Time Machine 本地快照，临时文件（按 7 天未修改过滤，避免动正在使用的文件）、系统诊断数据、休眠镜像、AI 模型缓存、iOS 模拟器、外接卷废纸篓；②巡检：CPU/内存/网络/硬盘只读仪表盘；③运维：Docker 构建完成监控、Docker Desktop 卡死恢复；④交付前安全：首次推送的凭据体检、删项目目录的风险核查、本地网页浏览器验证、同源项目文档合并。自动适配不同 macOS 版本路径差异，默认移入回收站可恢复，破坏性操作逐项确认。任何支持从 URL 安装 Skill 的智能体均可使用。",
    tags:["macOS","清理","释放空间","Docker","凭据体检","运维"]
  },
  {
    ico:"🌐", name:"官网 AI 友好化改造（GEO）", slug:"geo/ai-friendly-site",
    desc:"让 AI 搜索引擎（ChatGPT/Gemini/DeepSeek/豆包等）在回答「买哪个 / 哪家是正品」时准确推荐你、对冲仿冒。基于本地项目 / 目录 / 网站 URL 审计 AI 友好化缺口（llms.txt、schema.org JSON-LD、FAQ 标准答案页、正品声明页、实体一致性、内链），并生成可直接落地的优化文件。",
    tags:["GEO","AI友好化","SEO","llms.txt","JSON-LD"]
  },
  {
    ico:"📖", name:"精读一书智能体", slug:"book-brief-agent",
    desc:"把一本书（默认全书，可指定单章/多章；支持 PDF/EPUB/MOBI/TXT 等）蒸馏成 8~9 分钟精读稿：素材获取 → 分块摘要 → 主线合并 → 压缩成稿 → 事实校验，附时长估算与 SRT 字幕；在工具可用时接力配音、分镜配图与视频成片，默认只交付文字稿。",
    tags:["精读","讲书","口播稿","短视频"]
  },
  // —— IPSwordmaster 知识产权维权技能（13 个，归组于 skills/ipswordmaster/，slug 带分组前缀）——
  {
    ico:"🔍", name:"权利核查与监测", slug:"ipswordmaster/ip-rights-audit",
    desc:"维权启动前的确权核查与监测体系搭建：核查专利/商标/著作权/商业秘密的有效性、权属、保护范围与剩余期限，生成权利资产清单，办理知识产权海关保护备案，搭建电商/线下/展会/社媒的侵权监测体系。",
    tags:["确权","海关备案","侵权监测"]
  },
  {
    ico:"📡", name:"侵权线索发现", slug:"ipswordmaster/ip-infringement-discovery",
    desc:"知识产权侵权线索发现与初判：多渠道（电商平台、线下市场、展会、社交媒体、海关、域名）收集疑似侵权线索，锁定侵权主体及其生产/销售/进出口链条，按权利类型做初步判断并分级排序。",
    tags:["线索发现","侵权初判","渠道监测"]
  },
  {
    ico:"🧐", name:"知识产权侵权线索研判", slug:"ipswordmaster/ip-infringement-screening",
    desc:"批量研判侵权线索，输出侵权类型、近似度、证据强度、风险分级与处置建议，可直接回填维权台账。",
    tags:["侵权研判","风险分级","维权台账"]
  },
  {
    ico:"⚖️", name:"侵权比对与风险评估", slug:"ipswordmaster/ip-infringement-analysis",
    desc:"知识产权侵权比对与风险评估：将被控侵权方案/标识/作品/技术信息与权利文本逐项比对，按专利（全面覆盖/等同）、商标（相同近似+混淆）、著作权（接触+实质性相似）、商业秘密（三要件+密点对应）判断是否构成侵权，预判被告抗辩并评估胜诉可能性。",
    tags:["侵权比对","胜诉评估","抗辩预判"]
  },
  {
    ico:"📸", name:"取证固证助手", slug:"ipswordmaster/ip-evidence-collection",
    desc:"生成侵权线索的取证操作清单、证据目录与存证材料清单，并给出固证方式选择建议。",
    tags:["取证","固证","证据目录"]
  },
  {
    ico:"📝", name:"平台投诉方案", slug:"ipswordmaster/ip-complaint-playbook",
    desc:"生成平台投诉方案：通道选择、案由、材料清单、侵权对比说明、提交节奏、驳回补救与申诉应对。",
    tags:["投诉方案","案由","申诉应对"]
  },
  {
    ico:"🛒", name:"电商平台投诉", slug:"ipswordmaster/ip-platform-complaint",
    desc:"电商平台知识产权投诉（通知-删除）与申诉应对：向淘天（淘宝/天猫IPP）、京东、拼多多、抖音等平台发起商标/专利/著作权投诉、提交合格通知、跟进处理、应对卖家申诉、申请平台介入。",
    tags:["平台投诉","通知-删除","下架"]
  },
  {
    ico:"🏛️", name:"行政保护维权", slug:"ipswordmaster/ip-administrative-action",
    desc:"知识产权行政保护路径：专利侵权纠纷行政裁决、商标侵权行政查处、著作权行政处罚、知识产权海关保护。用于选择行政维权路径、准备请求/举报/处罚材料、跟进行政程序时限、申请海关备案与扣留侵权嫌疑货物。",
    tags:["行政裁决","行政查处","海关保护"]
  },
  {
    ico:"⚔️", name:"知识产权民事诉讼", slug:"ipswordmaster/ip-civil-litigation",
    desc:"知识产权民事诉讼：管辖确定、诉前/诉中行为保全（禁令）与财产/证据保全、起诉与举证、损害赔偿计算（实际损失/侵权获利/许可费合理倍数/法定赔偿、恶意侵权惩罚性赔偿）、一审二审程序。",
    tags:["民事诉讼","禁令","损害赔偿"]
  },
  {
    ico:"🚨", name:"刑事维权报案", slug:"ipswordmaster/ip-criminal-enforcement",
    desc:"知识产权刑事维权：假冒注册商标罪、销售假冒注册商标的商品罪、侵犯著作权罪、侵犯商业秘密罪、假冒专利罪的罪名识别、立案标准与报案/自诉流程，以及刑事附带民事赔偿衔接。",
    tags:["刑事报案","立案标准","刑附民"]
  },
  {
    ico:"📜", name:"裁判执行与监测", slug:"ipswordmaster/ip-judgment-execution",
    desc:"知识产权裁判执行与复发监测：申请强制执行（金钱给付/停止侵权）、执行异议与追加被执行人、拒不执行处置（限高/失信/罚款拘留/拒执罪）、维权复盘与重复侵权监测闭环。",
    tags:["强制执行","限高失信","复发监测"]
  },
  {
    ico:"🌐", name:"跨境知识产权维权", slug:"ipswordmaster/ip-cross-border-enforcement",
    desc:"知识产权跨境维权：中国出口环节海关保护、境外电商平台投诉（Amazon Brand Registry/eBay VeRO/AliExpress/TikTok Shop等）、境外侵权排查与行政司法救济（美国 ITC 337 调查、海外诉讼/仲裁、国际展会维权）、以及马德里商标/PCT 专利国际布局与跨境证据衔接。",
    tags:["跨境维权","海关出口","境外平台"]
  },
  {
    ico:"💬", name:"法言法语翻译器", slug:"ipswordmaster/legal-lingo-translator",
    desc:"法言法语翻译器。正向把日常口语/白话改写为庭审陈述、起诉状、报案材料、劳动仲裁申请书等法律文书可用的规范书面语；反向把判决书、律师函、合同条款、法条翻译成大白话并点明实际影响与关键期限。覆盖民事纠纷、刑事报案、劳动争议、婚姻家事等场景。",
    tags:["法言法语","文书改写","白话翻译"]
  }
  // 示例：网页应用内提供、未放入 skills/ 目录的 skill
  // { ico:"🧩", name:"示例 Skill", desc:"…", url:"https://example.com/skills/foo/SKILL.md", tags:["示例"] }
];

export const APIS = [
  { key:"common", label:"通用接口", items:[
    { m:"GET", p:"/", d:"根路由，服务健康检查" },
    { m:"GET", p:"/doc", d:"接口文档页" }
  ]},
  { key:"auth", label:"用户认证", items:[
    { m:"POST", p:"/login", d:"用户登录，签发 JWT" },
    { m:"POST", p:"/register", d:"用户注册" }
  ]},
  { key:"whois", label:"WHOIS 域名查询", items:[
    { m:"GET", p:"/whois/:domain", d:"查询域名 WHOIS 信息" }
  ]},
  { key:"email", label:"邮件发送", items:[
    { m:"POST", p:"/send-email", d:"发送邮件（含附件上传）" }
  ]},
  { key:"wecom", label:"企业微信接口", items:[
    { m:"GET", p:"/wecom/get-token", d:"获取 access_token" },
    { m:"GET", p:"/wecom/departments", d:"获取部门列表" },
    { m:"POST", p:"/wecom/departments", d:"创建部门" },
    { m:"PUT", p:"/wecom/departments/:id", d:"更新部门" },
    { m:"DELETE", p:"/wecom/departments/:id", d:"删除部门" },
    { m:"GET", p:"/wecom/users", d:"获取部门成员" },
    { m:"GET", p:"/wecom/users/:userid", d:"获取成员详情" },
    { m:"GET", p:"/wecom/users/search", d:"搜索成员" },
    { m:"POST", p:"/wecom/users", d:"创建成员" },
    { m:"PUT", p:"/wecom/users/:userid", d:"更新成员" },
    { m:"DELETE", p:"/wecom/users", d:"批量删除成员" },
    { m:"GET", p:"/wecom/agents", d:"获取应用列表" },
    { m:"GET", p:"/wecom/agents/:agentid", d:"获取应用详情" },
    { m:"POST", p:"/wecom/send-message", d:"发送应用消息" },
    { m:"POST", p:"/wecom/webhook/send", d:"发送群机器人消息" },
    { m:"POST", p:"/wecom/webhook/upload", d:"上传机器人文件" },
    { m:"GET", p:"/wecom/oauth/authorize", d:"构造授权 URL" },
    { m:"GET", p:"/wecom/oauth/userinfo", d:"code 换取成员身份" },
    { m:"GET", p:"/wecom/oauth/userdetail", d:"获取成员详情" },
    { m:"POST", p:"/wecom/media/upload", d:"上传临时素材" },
    { m:"POST", p:"/wecom/media/upload-img", d:"上传永久图片" },
    { m:"GET", p:"/wecom/media/:media_id", d:"获取素材" }
  ]},
  { key:"ip", label:"IP 工具", items:[
    { m:"GET", p:"/ip/", d:"获取访问者 IP 及归属地" },
    { m:"GET", p:"/ip/scan", d:"IP 端口扫描" }
  ]},
  { key:"wechat", label:"微信接口", items:[
    { m:"GET", p:"/wechat/", d:"微信 API 根路由" },
    { m:"GET", p:"/wechat/auth", d:"微信网页授权" },
    { m:"GET", p:"/wechat/userinfo", d:"获取微信用户信息" },
    { m:"GET", p:"/wechat/get-accesstoken", d:"获取公众号 access_token" },
    { m:"GET", p:"/wechat/refresh-accesstoken", d:"刷新网页授权 access_token" },
    { m:"GET", p:"/wechat/check-accesstoken", d:"验证 access_token 有效性" },
    { m:"GET", p:"/wechat/signature", d:"获取 JS-SDK 签名" },
    { m:"POST", p:"/wechat/send-notification", d:"发送模板消息" },
    { m:"GET", p:"/wechat/generate-qrcode", d:"生成带参数二维码" },
    { m:"GET", p:"/wechat/qrcode-login-callback", d:"扫码登录回调" },
    { m:"POST", p:"/wechat/menu", d:"创建自定义菜单" },
    { m:"GET", p:"/wechat/menu", d:"查询当前菜单" },
    { m:"DELETE", p:"/wechat/menu", d:"删除自定义菜单" },
    { m:"GET", p:"/wechat/followers", d:"获取关注者列表" },
    { m:"GET", p:"/wechat/userinfo-oa", d:"获取公众号用户基本信息" },
    { m:"POST", p:"/wechat/batch-userinfo", d:"批量获取用户基本信息" },
    { m:"POST", p:"/wechat/send-custom-message", d:"发送客服消息" },
    { m:"GET", p:"/wechat/materials", d:"获取素材列表" }
  ]},
  { key:"dingtalk", label:"钉钉接口", items:[
    { m:"GET", p:"/dingtalk/get-token", d:"获取 access_token" },
    { m:"GET", p:"/dingtalk/oauth/authorize", d:"构造扫码登录 URL" },
    { m:"GET", p:"/dingtalk/oauth/userinfo", d:"code 换取用户信息" },
    { m:"POST", p:"/dingtalk/send-message", d:"发送工作通知" },
    { m:"GET", p:"/dingtalk/send-message/result", d:"查询发送结果" },
    { m:"POST", p:"/dingtalk/webhook/send", d:"发送群机器人消息" },
    { m:"POST", p:"/dingtalk/media/upload", d:"上传媒体文件" },
    { m:"POST", p:"/dingtalk/callback", d:"事件回调接收" },
    { m:"GET", p:"/dingtalk/callback/config", d:"查看回调配置状态" }
  ]},
  { key:"xhs", label:"小红书接口", items:[
    { m:"GET", p:"/xhs/auth", d:"小红书 OAuth 授权" },
    { m:"POST", p:"/xhs/getXhsSignature", d:"获取小红书 API 签名" }
  ]},
  { key:"verify", label:"公众号域名验证", items:[
    { m:"GET", p:"/MP_verify_XXXXXXXX.txt", d:"微信域名验证文件" }
  ]},
  { key:"tts", label:"Edge TTS 语音合成", items:[
    { m:"GET", p:"/tts/", d:"根路由" },
    { m:"GET", p:"/tts/voices", d:"获取音色列表" },
    { m:"GET", p:"/tts/synthesize", d:"文本转语音（查询串）" },
    { m:"POST", p:"/tts/synthesize", d:"文本转语音（JSON body）" }
  ]},
  { key:"sso", label:"SSO / OIDC 授权登录", items:[
    { m:"GET", p:"/sso/.well-known/openid-configuration", d:"OIDC discovery 文档" },
    { m:"GET", p:"/sso/auth", d:"授权端点（别名 /sso/authorize）" },
    { m:"POST", p:"/sso/token", d:"换 access_token + id_token" },
    { m:"GET", p:"/sso/me", d:"取用户信息（别名 /sso/userinfo）" },
    { m:"GET", p:"/sso/jwks", d:"发布 RSA 公钥" },
    { m:"GET", p:"/sso/session/end", d:"OIDC 会话注销" },
    { m:"GET", p:"/sso/login", d:"统一登录页" },
    { m:"GET", p:"/sso/logout", d:"清除身份桥接 Cookie" },
    { m:"GET", p:"/sso/social/:provider/start", d:"发起社交登录" },
    { m:"GET", p:"/sso/social/:provider/callback", d:"社交登录回调" }
  ]},
  { key:"checkin", label:"会议签到存储", items:[
    { m:"POST", p:"/checkin/meeting", d:"创建会议（返回 mid）" },
    { m:"GET", p:"/checkin/meeting/:mid", d:"获取会议定义（公开）" },
    { m:"PUT", p:"/checkin/meeting/:mid", d:"修改会议（口令校验）" },
    { m:"GET", p:"/checkin/sign/:mid", d:"获取签到名单（口令校验）" },
    { m:"POST", p:"/checkin/sign/:mid", d:"公开签到，手机号查重" },
    { m:"DELETE", p:"/checkin/sign/:mid/:sid", d:"删除单条签到（口令校验）" },
    { m:"DELETE", p:"/checkin/sign/:mid", d:"清空全部签到（口令校验）" }
  ]},
  { key:"shortlink", label:"短链接 API", items:[
    { m:"POST", p:"https://captcha.gurl.eu.org/api/challenge", d:"步骤1·获取验证码：返回 {challenge:{c,s,d}, token, expires}，取出 token 作为下一步的 captcha_token 备用" },
    { m:"POST", p:"https://link.0net.in", d:"步骤2·创建短链：Content-Type 为 application/json，body 传 {url, captcha_token}；返回 {status, key, short_url}，正式短链 = https://link.0net.in + key（去掉 key 前导斜杠，如 /HrmRky → https://link.0net.in/HrmRky）" }
  ]}
];

export const API_BASE = "https://utils.api.zhenzhidaole.com";
