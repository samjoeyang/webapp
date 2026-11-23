# 诉讼费用计算器（Litigation Fee Calculator）

一个专注中国诉讼费用测算的 Agent 型专家。依据《诉讼费用交纳办法》（国务院令第481号）及公证、律师、评估、拍卖等价格规定，精确计算**法院法定诉讼费**，并合理估算**与诉讼相关的全部市场化成本**，区分「法定·精确」与「市场化·估算」两层并给出合计。

## 类型

Agent 型（单个 AI 专家）

## 核心功能

- **法院法定诉讼费（精确）**：案件受理费（财产案件 10 档分段累计、离婚、人格权、其他非财产、知识产权有/无争议金额、劳动争议、行政、管辖权异议）+ 申请费（执行、保全≤5000、支付令=财产受理费 1/3、公示催告、撤销仲裁、破产减半≤30 万），支持减半与地方标准。
- **维权相关成本估算（市场化）**：律师费（指导价差额累进/风险代理≤18%/计件）、财产保全保险费、公证费（5 种模式）、鉴定费、评估费、拍卖费、公告费、翻译费、差旅费。
- **组合测算与合计**：一键算清「起诉+保全+执行+律师」等全流程花费，输出分层明细。

## 计算引擎

- `skills/litigation-fee-calculator/scripts/calculate.py`：纯标准库 Python3，零依赖，支持 `--json` 输出。
- `skills/litigation-fee-calculator/references/fee_schedule.md`：权威费率速查表。

## 使用示例

- 「知识产权维权案件，诉讼标的 50 万，大概要花多少费用」
- 「财产案件标的 100 万，法院受理费要交多少」
- 「打一场官司全流程要花多少：起诉+保全+执行+请律师」

## 头像

头像已自动生成在 `avatars/expert.png`（暗灰蓝背景，天平+计算器法务主题）。如需替换：PNG/JPG，512×512 px，≤500KB。

## 安装与注册

将本目录放到专家目录下，并运行注册脚本使其在工作台可见：

```bash
# 专家目录（本机）
~/.workbuddy/plugins/marketplaces/my-experts/plugins/litigation-fee-calculator/

# 注册
python3 <expert-manager>/scripts/register_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/litigation-fee-calculator
```

## 打包分享（注意中文文件名 UTF-8 标记）

```bash
python3 <expert-manager>/scripts/package_expert.py \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins/litigation-fee-calculator \
  ./output
```

> 提示：本专家含半年一次的费率复核自动化，会联网核对《诉讼费用交纳办法》是否修订并同步更新费率。测算结果不构成法律意见，市场化价格以实际报价/票据为准。
