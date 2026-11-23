# 知识产权全链路顾问（IP Full-Chain Consultant）

基于「知识产权全链路维权技能包（ipswordmaster，知产刀客 · SamjoeYang）」打造的 WorkBuddy 专家，定位为知识产权战略顾问。覆盖 IP 保护全链路：确权监测（S0）→ 侵权发现（S1）→ 侵权研判 / 比对（S2）→ 证据固定（S3）→ 平台投诉（S4）→ 行政保护（S5）→ 争议解决（S6）→ 刑事路径（S7）→ 判决执行（S8），并贯穿跨境保护。

## 类型

Agent 型（单个 AI 专家）

## 功能

- **全链路路径决策**：判定线索所处阶段，给出「先做什么、能否并行、何时升级」的处置节奏与路径组合建议。
- **12 个内置技能**（来自原技能包，作为专家技能挂载）：
  - `ip-rights-audit`（S0 确权与监测）
  - `ip-infringement-discovery`（S1 侵权发现）
  - `ip-infringement-screening`（S1–S2 侵权研判）
  - `ip-infringement-analysis`（S2 侵权比对）
  - `ip-evidence-collection`（S3 证据固定）
  - `ip-complaint-playbook`（S4 平台投诉方案）
  - `ip-platform-complaint`（S4 平台投诉执行）
  - `ip-administrative-action`（S5 行政保护）
  - `ip-civil-litigation`（S6 争议解决 / 民事诉讼）
  - `ip-criminal-enforcement`（S7 刑事路径）
  - `ip-judgment-execution`（S8 执行监测）
  - `ip-cross-border-enforcement`（跨境保护）

## 使用示例

- 「我有一批侵权线索，帮我走一遍全链路顾问方案」
- 「这个案子该走平台投诉、行政还是争议解决？帮我决策」
- 「帮我做侵权比对和保护可行性评估」

## 注意事项

- 本专家产出为内部研判 / 操作参考，**不构成法律意见或正式法律服务**；对外行动须经具备执业资格的专业人员复核。
- 禁止承诺结果（如「一定能下架 / 必然成功」）。
- 取证须合法，涉个人信息与案件保密信息不得外泄。

## 头像

头像已生成在 `avatars/expert.png`（保留原图）。

## 安装

专家包已置于专家目录：

```
/Users/samjoeyang/.workbuddy/plugins/marketplaces/my-experts/plugins/ip-fullchain-enforcement-expert/
```

已通过 `register_expert.py` 注册，可在 WorkBuddy「专家中心 - 我的专家」中直接使用。

## 打包分享

```bash
python3 scripts/package_expert.py ip-fullchain-enforcement-expert
```
