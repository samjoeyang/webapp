# 微信收纳师 (WeChat Attachment Organizer)

基于 `wechat-attachment-organizer` 技能转化的 WorkBuddy 专家。自动扫描微信 PC 端本地附件，按类型或客户分类、解码 `.dat` 还原真实格式、用 sha256 智能去重，安全复制不删源，并可导入资料库全文检索。合规版——只做文件系统读取与复制，绝不访问或解密聊天数据库。

## 类型

Agent 型（单个 AI 专家）

## 功能

- **跨平台探测**：Windows / macOS / Linux，微信 3.x 与 4.x 自动区分，多账号自动列出。
- **.dat 解码**：靠文件头 magic 反推 XOR 密钥，还原 jpg/png/gif/bmp/pdf/zip/mp4 真实格式与扩展名。
- **分类**：按类型（文档/表格/图片/视频/压缩包/音频/其他 + 年-月）、按客户（文件名 + 文档正文双路匹配）、或自定义规则。
- **去重**：按 sha256 内容去重，同内容只保留一份，绝不靠文件名判断。
- **安全与增量**：默认 dry-run 预览，显式 `--apply` 才复制；`.wxa_state.json` 支持增量重跑。
- **入库检索**：整理后可导入资料库，文本类可全文检索。
- **产出清单**：`wxa_manifest.json`（完整索引）、`dedup_report.json`（重复线索）、`wxa_upload_manifest.json`（入库清单）。

## 使用示例

- 帮我扫描微信里的附件，按类型分类整理到文件夹
- 按客户把微信收到的文件归类到对应目录
- 先看看微信里有哪些重复文件，能省多少空间

## 合规与边界

- 只读取/复制本地文件，不读取、不解密、不导出聊天数据库（MSGx.db）。
- 复制不移动、不删除源文件；默认仅预览，必须确认后才执行。
- 分类结果（尤其客户名）属用户私有，不外传、不擅自上传。

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：
- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 安装

专家包已位于专家目录：

```
/Users/samjoeyang/.workbuddy/plugins/marketplaces/my-experts/plugins/wechat-attachment-organizer/
```

运行注册命令使其可见：

```bash
python3 scripts/register_expert.py <expert-dir>
```

## 打包分享

```bash
zip -r wechat-attachment-organizer.zip wechat-attachment-organizer/
```
