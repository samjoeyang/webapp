---
name: cn-litigation-fee-calculator
version: 1.1.0
display_name: 诉讼费用计算器
display_name_en: Litigation Fee Calculator
description_zh: '全面测算与诉讼相关的全部费用：法院法定诉讼费（案件受理费+申请费）、律师费、财产保全担保/保险费、公证费、鉴定费、评估费、拍卖费、公告费、翻译费、差旅费，并区分“法定”与“估算”两层。覆盖财产/离婚/人格权/知识产权/劳动/行政/管辖异议等全部案件类型与减半情形。'
description_en: 'Comprehensive litigation cost estimator covering all litigation-related fees: statutory court fees (acceptance + application), lawyer fees, preservation insurance, notary, appraisal, evaluation, auction, announcement, translation, travel — split into "statutory" and "estimated" layers.'
description: '诉讼费用计算器、诉讼费、案件受理费、申请费、保全费、执行费、支付令、公示催告、破产申请费、律师费、保全保险费、公证费、鉴定费、评估费、拍卖费、公告费、翻译费、维权成本测算、财产案件分段累计、减半交纳。当用户说「算一下诉讼费/这个标的额法院收多少/保全要交多少/执行费怎么算/请律师大概多少钱/打官司一共要花多少/离婚/劳动仲裁/知识产权诉讼要多少费用」时使用。尤其适合 IP 维权场景估算起诉+保全+执行+律师的全流程成本。'
auto_update: true
agent_created: true
author: SamjoeYang - 上海不丁网络科技有限公司
license: MIT
source_of_truth: webapps/skills/litigation-fee-calculator/
---

# 诉讼费用计算器

全面测算**与诉讼有关的一切费用**，并区分为两层：
- **【一、法院诉讼费（法定）】**：权威计算，以《诉讼费用交纳办法》（国务院令第481号）为准。
- **【二、其他诉讼相关费用（市场化·估算）】**：律师费、保全保险费、公证费、鉴定费、评估费、拍卖费、公告费、翻译费、差旅费——以实际委托合同与票据为准，本计算器给出合理估算区间/公式。

## 一、费用全景（尽量全面）
| 类别 | 项目 | 性质 | 本 skill 处理 |
|---|---|---|---|
| 法院诉讼费 | 案件受理费（一审/二审/再审） | 法定 | ✅ 精确 |
| 法院诉讼费 | 申请费（执行/保全/支付令/公示催告/撤销仲裁/破产/海事） | 法定 | ✅ 精确 |
| 法院诉讼费 | 证人·鉴定人·翻译人·理算人出庭费、卷宗复制工本费 | 法定·发生时 | ℹ️ 提示（无统一公式） |
| 维权成本 | 律师费（政府指导价/风险代理/计件） | 市场化 | ✅ 估算 |
| 维权成本 | 财产保全责任保险费 / 保函费 | 市场化 | ✅ 估算 |
| 维权成本 | 公证费（证据保全/合同/财产类/文书相符） | 市场化 | ✅ 估算（5 种模式） |
| 维权成本 | 鉴定费（文书/工程/司法会计等） | 市场化 | ✅ 估算 |
| 维权成本 | 评估费（资产评估，差额累进） | 市场化 | ✅ 估算 |
| 维权成本 | 拍卖费（佣金，受《拍卖法》≤5% 约束） | 市场化 | ✅ 估算 |
| 维权成本 | 公告费（法院公告登报） | 市场化 | ✅ 估算 |
| 维权成本 | 翻译费（涉外，按千字） | 市场化 | ✅ 估算 |
| 维权成本 | 差旅费 | 实报实销 | ✅ 估算（手动填入） |

## 二、何时启用
| 用户意图 | 调用方式 |
|---|---|
| 算法院受理费/申请费 | `--type` + 金额 + 对应申请费参数 |
| 估算请律师要花多少 | 加 `--lawyer`（可选 `--lawyer-mode guide/risk/lump`） |
| 打包维权总成本（起诉+保全+执行+律师） | 同时启用多项 |
| 调解/撤诉/简易程序/反诉减半 | 加 `--half` |
| 套用地方具体标准 | 加 `--locality <key>` |

## 三、核心脚本
`scripts/calculate.py`（纯标准库，Python 3，零依赖）。示例：

```
# 法院诉讼费：财产 100 万（应 13800）
python3 <skill>/scripts/calculate.py --type property --amount 1000000

# 全面维权成本：财产 100 万 + 保全 20 万(保险0.2%) + 执行 50 万 + 律师(指导价) + 鉴定 + 评估 500 万 + 公告 + 翻译1万字
python3 <skill>/scripts/calculate.py --type property --amount 1000000 \
  --preserve-amount 200000 --insurance-rate 0.002 --exec-amount 500000 \
  --lawyer --lawyer-mode guide --appraisal --appraisal-type document \
  --evaluation-amount 5000000 --announcement --translation-words 10000

# 律师费：风险代理 100 万 @18%（应 180000）
python3 <skill>/scripts/calculate.py --type property --amount 0 --lawyer --lawyer-mode risk --lawyer-amount 1000000

# 减半（简易程序）
python3 <skill>/scripts/calculate.py --type property --amount 1000000 --half

# 机器可读
python3 <skill>/scripts/calculate.py --type property --amount 500000 --json
```

### 参数速查
- **受理费** `--type`：`property`/`divorce`/`personality`/`other_nonproperty`/`ip`/`labor`/`admin`/`jurisdiction`；`--amount`/`--base`/`--property-total`/`--damages`/`--subtype`/`--locality`/`--half`
- **申请费**：`--exec-amount`/`--exec-no-amount`(基费 `--exec-base` 默认500)/`--preserve-amount`/`--payment-order`/`--public-notice`/`--revoke-arbitration`/`--bankruptcy-amount`
- **律师费** `--lawyer` + `--lawyer-mode {guide,risk,lump}`；`--lawyer-amount`(默认=amount)/`--lawyer-base`(默认5000)/`--lawyer-lump`/`--lawyer-risk-rate`(默认0.18)
- **其他估算**：`--insurance-rate`(保全保险费)/`--notary`+`--notary-mode{property,contract,evidence,document,lump}`(默认evidence证据保全)+`--notary-amount`(默认=amount)/`--notary-fee`(手动直接给定，优先于mode)/`--appraisal`+`--appraisal-type{document,construction,accounting,other}`+`--appraisal-amount`/`--evaluation-amount`(评估费)/`--auction-amount`(拍卖费)/`--announcement`(+`--announcement-fee`默认600)/`--translation-words`(+`--translation-rate`默认300)/`--travel-fee`(差旅费)
- `--json`：结构化输出（含 `court_fee_items`/`court_fee_total`/`other_cost_items`/`other_cost_total`/`grand_total`）

## 四、规则依据
- 法院诉讼费：全部费率见 `references/fee_schedule.md`，已与 gov.cn 公布文本逐条核对（核验日 2026-10-29，办法未修订）。
- 律师费：采用各省政府指导价的中位水平（财产案件差额累进 + 基础费下限），风险代理按 ≤18% 上限；**具体以当地《律师服务收费管理办法》及委托合同为准**。
- 评估费/拍卖费：参考历史差额累进收费标准（评估费 floor 1500；拍卖费受《拍卖法》≤5% 成交价约束），均为估算。
- 减半只作用于**案件受理费**；支付令是财产受理费的 **1/3**（独立规则）。
- 保全费上限 **5000 元**；破产按财产受理费减半、上限 **30 万**；执行费 >1000 万部分仅 0.1%。

## 五、输出与告知
- 脚本分两层打印明细 + 小计 + 合计，并注明“法院诉讼费为权威计算，其余为估算”。
- 向用户交付时提醒：① 法院费以《交纳诉讼费用通知》为准；② 律师/保险/公证/鉴定/评估/拍卖等以实际报价为准；③ 证人等出庭费、卷宗工本费、差旅费于发生时另计；④ 涉及地方具体标准时核对当地文件。

## 六、维护与更新（auto_update）
- **权威源**：`webapps/skills/litigation-fee-calculator/`（本 skill 的 source of truth）。
- **规则时效**：法院诉讼费锚定国务院令第 481 号；律师费/评估费/拍卖费等指导标准随各省政策调整，更新对应常量即可，CLI 接口保持不变。
- **地方标准扩展**：在 `calculate.py` 的 `LOCALITIES` 字典追加 `{key: {...}}`。
- **定期复核**：建议周期性（如每半年）复核 gov.cn / 最高法院及各省发改委、司法厅是否发布新标准或修订。
- **部署同步**：若挂到门户，需将本目录同步至 `public/skills/<slug>/` 并在 `src/data.js` 登记后 `npm run build`。
