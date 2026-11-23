#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
诉讼费用计算器  calculate.py  (v1.1.0)
依据：《诉讼费用交纳办法》（国务院令第481号，2007-04-01 施行）等。

覆盖范围（尽量全面）：
  【法定·法院收取】案件受理费 + 申请费
  【法定·法院代收/代付】证人·鉴定人·翻译人·理算人出庭费、卷宗复制工本费（发生时按实际）
  【市场化·维权成本（估算）】律师费、财产保全担保/保险费、公证费、鉴定费、
                          评估费、拍卖费、公告费、翻译费、差旅费

说明：
  - 法院诉讼费为权威计算；其余为“估算”，以实际报价/票据为准。
  - 减半情形（调解/撤诉、简易程序、反诉）只对“案件受理费”生效。
  - 财产保全保险费、公证费、律师费等法院外费用单独归类，不混入“法院诉讼费合计”。
  - 非财产案件中由省级政府在区间内自定的项目，默认值取国家区间上限；可用 --base 覆盖，
    或用 --locality 套用已内置的地方标准。
"""

import argparse
import json
import sys


# ===========================================================================
# 通用：差额累进
# ===========================================================================
def graduated(amount, brackets, floor=0.0):
    """差额累进：brackets = [(upper, rate), ...]，upper 可用 float('inf')。
    仅对落入各区间的增量部分按对应 rate 计费。floor 为最低收费。"""
    if amount is None or amount <= 0:
        return floor
    fee = 0.0
    lower = 0.0
    for upper, rate in brackets:
        if amount <= lower:
            break
        fee += (min(amount, upper) - lower) * rate
        lower = upper
    fee = round(fee, 2)
    return max(fee, floor) if floor else fee


# ===========================================================================
# 一、法院诉讼费（法定，权威）
# ===========================================================================
def property_acceptance_fee(amount):
    """财产案件受理费（分段累计）。amount：诉讼请求金额/价额（元）。"""
    if amount is None or amount <= 0:
        return 0.0
    if amount <= 10000:
        return 50.0
    brackets = [
        (100000,   0.025), (200000,   0.020), (500000,   0.015),
        (1000000,  0.010), (2000000,  0.009), (5000000,  0.008),
        (10000000, 0.007), (20000000, 0.006), (float('inf'), 0.005),
    ]
    fee = 50.0
    lower = 10000.0
    for upper, rate in brackets:
        if amount <= lower:
            break
        fee += (min(amount, upper) - lower) * rate
        lower = upper
    return round(fee, 2)


def divorce_fee(base, property_total):
    fee = base
    if property_total and property_total > 200000:
        fee += (property_total - 200000) * 0.005
    return round(fee, 2)


def personality_fee(base, damages):
    fee = base
    if damages and damages > 50000:
        if damages <= 100000:
            fee += (damages - 50000) * 0.01
        else:
            fee += 50000 * 0.01 + (damages - 100000) * 0.005
    return round(fee, 2)


def other_nonproperty_fee(base):
    return round(base, 2)


def ip_fee(has_amount, amount, base_no_amount):
    return property_acceptance_fee(amount) if has_amount else round(base_no_amount, 2)


def labor_fee():
    return 10.0


def admin_fee(subtype):
    return 100.0 if subtype == 'trademark' else 50.0


def jurisdiction_fee(base):
    return round(base, 2)


def execution_fee(amount, base_no_amount=500.0):
    if amount is None or amount <= 0:
        return round(base_no_amount, 2)
    brackets = [
        (500000,   0.015), (5000000,  0.010), (10000000, 0.005),
        (float('inf'), 0.001),
    ]
    fee = 50.0
    lower = 10000.0
    for upper, rate in brackets:
        if amount <= lower:
            break
        fee += (min(amount, upper) - lower) * rate
        lower = upper
    return round(fee, 2)


def preservation_fee(amount):
    if amount is None or amount <= 1000:
        return 30.0
    if amount <= 100000:
        return round(30.0 + (amount - 1000) * 0.01, 2)
    fee = 30.0 + (100000 - 1000) * 0.01 + (amount - 100000) * 0.005
    return min(round(fee, 2), 5000.0)


def payment_order_fee(amount):
    return round(property_acceptance_fee(amount) / 3.0, 2)


def public_notice_fee():
    return 100.0


def revoke_arbitration_fee():
    return 400.0


def bankruptcy_fee(amount):
    return min(round(property_acceptance_fee(amount) / 2.0, 2), 300000.0)


# 地方标准（法定幅度内自定）
LOCALITIES = {
    'guiyang_nanming': {
        'divorce_base': 200, 'personality_base': 300,
        'other_nonproperty_base': 60, 'ip_no_amount_base': 800,
        'jurisdiction_base': 60,
    },
}
DEFAULT_RANGES = {
    'divorce_base': 300, 'personality_base': 500,
    'other_nonproperty_base': 100, 'ip_no_amount_base': 1000,
    'jurisdiction_base': 100,
}


# ===========================================================================
# 二、律师费（市场化，估算，各省政府指导价区间）
# ===========================================================================
# 财产案件：差额累进（代表各省指导价上限的中位水平），含最低基础费
LAWYER_GUIDE_BRACKETS = [
    (100000,   0.07), (500000,   0.06), (1000000,  0.05),
    (5000000,  0.04), (10000000, 0.03), (50000000, 0.02),
    (float('inf'), 0.01),
]
LAWYER_BASE_FLOOR = 5000.0          # 最低收费（计件基础）
RISK_AGENCY_CAP = 0.18              # 风险代理累计最高比例（标的额）


def lawyer_fee(mode, amount, base_floor=LAWYER_BASE_FLOOR, risk_rate=RISK_AGENCY_CAP, lump=None):
    if mode == 'lump':
        return round(lump if lump is not None else base_floor, 2)
    if mode == 'risk':
        if amount is None or amount <= 0:
            return 0.0
        return round(min(amount * risk_rate, amount * RISK_AGENCY_CAP), 2)
    # guide：差额累进 + 基础费下限
    return graduated(amount, LAWYER_GUIDE_BRACKETS, floor=base_floor)


# ===========================================================================
# 三、其他诉讼相关费用（市场化，估算）
# ===========================================================================
# 评估费（资产评估，差额累进，参考历史收费标准，估算）
EVAL_BRACKETS = [
    (1000000,   0.009), (10000000, 0.00375), (100000000, 0.0012),
    (1000000000, 0.0003), (float('inf'), 0.00008),
]
EVAL_FLOOR = 1500.0

# 拍卖费（佣金，差额累进，并受《拍卖法》≤5% 成交价约束，估算）
AUCTION_BRACKETS = [
    (2000000, 0.05), (10000000, 0.03), (50000000, 0.02), (float('inf'), 0.01),
]
AUCTION_CAP_RATE = 0.05

# 鉴定费常见项目（按件/按比例，区间大，给代表默认值，以机构报价为准）
APPRAISAL_DEFAULTS = {
    'document':  1500.0,   # 文书/痕迹/笔迹鉴定（件）
    'construction': None,  # 工程造价/质量：按造价比例，见下
    'accounting': None,    # 司法会计：按标的比例
    'other':     2000.0,
}
APPRAISAL_CONST_BRACKETS = [
    (1000000, 0.008), (5000000, 0.005), (float('inf'), 0.003),
]


def evaluation_fee(asset_amount):
    return graduated(asset_amount, EVAL_BRACKETS, floor=EVAL_FLOOR)


def auction_fee(deal_amount):
    f = graduated(deal_amount, AUCTION_BRACKETS)
    return min(f, round(deal_amount * AUCTION_CAP_RATE, 2)) if deal_amount else 0.0


def appraisal_fee(atype, amount=None, fee=None):
    if fee is not None:
        return round(fee, 2)
    if atype == 'construction' or atype == 'accounting':
        return graduated(amount, APPRAISAL_CONST_BRACKETS) if amount else 0.0
    return APPRAISAL_DEFAULTS.get(atype, APPRAISAL_DEFAULTS['other'])


def announcement_fee(fee):
    return round(fee, 2)


def translation_fee(words, rate_per_k):
    if not words:
        return 0.0
    return round((words / 1000.0) * rate_per_k, 2)


# ---------------------------------------------------------------------------
# 公证费（市场化·估算，依据国家发改委、司法部《关于进一步完善公证服务
# 价格形成机制的指导意见》发改价格〔2021〕1081号 及各地公证服务收费标准）
# ---------------------------------------------------------------------------
NOTARY_PROP_BRACKETS = [
    (200000,     0.012), (500000,    0.010), (5000000,   0.008),
    (10000000,   0.005), (100000000, 0.001), (float('inf'), 0.0005),
]
NOTARY_CONTRACT_RATE = 0.003      # 合同/协议类按标的额比例
NOTARY_EVIDENCE_FEE  = 1000.0     # 保全证据公证·按件（IP维权最常见）
NOTARY_DOC_FEE       = 50.0       # 文书副本/译本相符·按件
NOTARY_FLOOR         = 200.0      # 最低收费

def notary_fee(mode, amount=None, fee=None):
    """公证费估算。
    mode:
      property  财产类（继承/赠与/遗赠/财产分割）按标的额差额累进
      contract  合同/协议类按标的额比例
      evidence  保全证据公证·按件（知识产权维权取证最常用）
      document  文书副本/译本相符·按件
      lump      直接给定金额
    """
    if mode == 'lump':
        return round(fee if fee is not None else NOTARY_DOC_FEE, 2)
    if mode == 'evidence':
        return round(NOTARY_EVIDENCE_FEE, 2)
    if mode == 'document':
        return round(NOTARY_DOC_FEE, 2)
    a = amount or 0.0
    if mode == 'contract':
        return round(max(a * NOTARY_CONTRACT_RATE, NOTARY_FLOOR), 2)
    # property（默认）
    return graduated(a, NOTARY_PROP_BRACKETS, floor=NOTARY_FLOOR)


# ===========================================================================
# 主计算
# ===========================================================================
def calculate(args):
    loc = LOCALITIES.get(args.locality, {}) if args.locality else {}
    d = dict(DEFAULT_RANGES)
    d.update(loc)

    court_items = []     # 法院诉讼费明细（法定）
    court_total = 0.0
    other_items = []     # 其他诉讼相关费用（估算）
    other_total = 0.0

    # ---- 案件受理费 ----
    t = args.type
    if t == 'property':
        acceptance = property_acceptance_fee(args.amount)
    elif t == 'divorce':
        acceptance = divorce_fee(args.base or d['divorce_base'], args.property_total)
    elif t == 'personality':
        acceptance = personality_fee(args.base or d['personality_base'], args.damages)
    elif t == 'other_nonproperty':
        acceptance = other_nonproperty_fee(args.base or d['other_nonproperty_base'])
    elif t == 'ip':
        acceptance = (ip_fee(True, args.amount, 0) if args.amount is not None
                      else ip_fee(False, 0, args.base or d['ip_no_amount_base']))
    elif t == 'labor':
        acceptance = labor_fee()
    elif t == 'admin':
        acceptance = admin_fee(args.subtype)
    elif t == 'jurisdiction':
        acceptance = jurisdiction_fee(args.base or d['jurisdiction_base'])
    else:
        raise SystemExit(f'未知案件类型: {t}')

    half_reason = None
    acceptance_full = acceptance
    if args.half:
        half_reason = '减半'
        acceptance = acceptance / 2.0

    has_app_fee = any([args.exec_amount is not None or args.exec_no_amount,
                       args.preserve_amount is not None, args.payment_order,
                       args.public_notice, args.revoke_arbitration,
                       args.bankruptcy_amount is not None])
    if acceptance_full > 0 or not has_app_fee:
        label = {
            'property': '案件受理费（财产案件）',
            'divorce': '案件受理费（离婚案件）',
            'personality': '案件受理费（人格权案件）',
            'other_nonproperty': '案件受理费（其他非财产案件）',
            'ip': ('案件受理费（知识产权·有争议金额）' if args.amount is not None
                   else '案件受理费（知识产权·无争议金额）'),
            'labor': '案件受理费（劳动争议）',
            'admin': '案件受理费（行政案件）',
            'jurisdiction': '案件受理费（管辖权异议不成立）',
        }[t]
        court_items.append((label, round(acceptance_full, 2)))
        if args.half:
            court_items.append(('　└ 减半（调解/撤诉/简易程序/反诉）', -round(acceptance_full / 2.0, 2)))
        court_total += acceptance

    # ---- 申请费 ----
    if args.exec_amount is not None or args.exec_no_amount:
        f = execution_fee(args.exec_amount, args.exec_base or 500.0)
        court_items.append(('申请费（执行）', f)); court_total += f
    if args.preserve_amount is not None:
        f = preservation_fee(args.preserve_amount)
        court_items.append(('申请费（保全）', f)); court_total += f
    if args.payment_order:
        f = payment_order_fee(args.amount if args.amount is not None else 0)
        court_items.append(('申请费（支付令）', f)); court_total += f
    if args.public_notice:
        f = public_notice_fee()
        court_items.append(('申请费（公示催告）', f)); court_total += f
    if args.revoke_arbitration:
        f = revoke_arbitration_fee()
        court_items.append(('申请费（撤销仲裁裁决/认定仲裁协议效力）', f)); court_total += f
    if args.bankruptcy_amount is not None:
        f = bankruptcy_fee(args.bankruptcy_amount)
        court_items.append(('申请费（破产，减半·上限30万）', f)); court_total += f

    # ---- 律师费（估算）----
    if args.lawyer:
        lamt = args.lawyer_amount if args.lawyer_amount is not None else args.amount
        f = lawyer_fee(args.lawyer_mode, lamt, args.lawyer_base,
                       args.lawyer_risk_rate, args.lawyer_lump)
        tag = {'guide': '律师费（估算·政府指导价）',
               'risk': '律师费（估算·风险代理，≤18%）',
               'lump': '律师费（估算·计件）'}[args.lawyer_mode]
        other_items.append((tag, f)); other_total += f

    # ---- 其他市场化费用（估算）----
    if args.insurance_rate is not None and args.preserve_amount is not None:
        ins = round(args.preserve_amount * args.insurance_rate, 2)
        other_items.append(('财产保全保险费（估，交保险公司）', ins)); other_total += ins
    # 公证费（市场化·估算）
    if args.notary or args.notary_fee is not None:
        if args.notary_fee is not None:
            nf = round(args.notary_fee, 2)
            nlabel = '公证费（估，交公证处·手动给定）'
        else:
            namt = args.notary_amount if args.notary_amount is not None else args.amount
            nf = notary_fee(args.notary_mode, namt)
            nlabel = {
                'property': '公证费（估，财产类·按标的差额累进）',
                'contract': '公证费（估，合同/协议·按标的比例）',
                'evidence': '公证费（估，证据保全·按件）',
                'document': '公证费（估，文书相符·按件）',
                'lump':     '公证费（估，交公证处·按件）',
            }[args.notary_mode]
        other_items.append((nlabel, nf)); other_total += nf
    if args.appraisal:
        f = appraisal_fee(args.appraisal_type, args.appraisal_amount, args.appraisal_fee)
        other_items.append(('鉴定费（估，交鉴定机构）', f)); other_total += f
    if args.evaluation_amount is not None:
        f = evaluation_fee(args.evaluation_amount)
        other_items.append(('评估费（估，交评估机构）', f)); other_total += f
    if args.auction_amount is not None:
        f = auction_fee(args.auction_amount)
        other_items.append(('拍卖费（估，交拍卖行）', f)); other_total += f
    if args.announcement:
        f = announcement_fee(args.announcement_fee)
        other_items.append(('公告费（估，法院公告登报）', f)); other_total += f
    if args.translation_words:
        f = translation_fee(args.translation_words, args.translation_rate)
        other_items.append(('翻译费（估，涉外，按千字）', f)); other_total += f
    if args.travel_fee is not None:
        other_items.append(('差旅费（估，实报实销）', args.travel_fee)); other_total += args.travel_fee

    court_total = round(court_total, 2)
    other_total = round(other_total, 2)
    grand = round(court_total + other_total, 2)

    return {
        'case_type': t,
        'locality': args.locality or 'national_default',
        'half_applied': half_reason,
        'court_fee_items': [{'name': n, 'amount': v} for n, v in court_items],
        'court_fee_total': court_total,
        'other_cost_items': [{'name': n, 'amount': v} for n, v in other_items],
        'other_cost_total': other_total,
        'grand_total': grand,
    }


def _print_section(title, items):
    print(title)
    for it in items:
        n, v = (it['name'], it['amount']) if isinstance(it, dict) else (it[0], it[1])
        print(f'{n:<44} ¥{v:,.2f}')
    if items:
        print('-' * 54)


def main():
    p = argparse.ArgumentParser(
        description='诉讼费用计算器 v1.1（法定诉讼费 + 全面维权成本估算）')
    # 案件/受理费
    p.add_argument('--type', required=True,
                   choices=['property', 'divorce', 'personality', 'other_nonproperty',
                            'ip', 'labor', 'admin', 'jurisdiction'])
    p.add_argument('--amount', type=float, default=None, help='诉讼请求金额/价额')
    p.add_argument('--base', type=float, default=None, help='非财产类固定基费覆盖')
    p.add_argument('--property-total', type=float, default=None, help='离婚财产分割总额')
    p.add_argument('--damages', type=float, default=None, help='人格权损害赔偿金额')
    p.add_argument('--subtype', default='other', choices=['trademark', 'other'])
    p.add_argument('--locality', default=None, help='地方标准，如 guiyang_nanming')
    p.add_argument('--half', action='store_true', help='案件受理费减半')
    # 申请费
    p.add_argument('--exec-amount', type=float, default=None, help='申请执行金额')
    p.add_argument('--exec-no-amount', action='store_true', help='执行无金额')
    p.add_argument('--exec-base', type=float, default=None, help='执行无金额基费(默认500)')
    p.add_argument('--preserve-amount', type=float, default=None, help='保全金额')
    p.add_argument('--insurance-rate', type=float, default=None, help='保全保险费费率(如0.002)')
    p.add_argument('--payment-order', action='store_true', help='支付令')
    p.add_argument('--public-notice', action='store_true', help='公示催告')
    p.add_argument('--revoke-arbitration', action='store_true', help='撤销仲裁裁决')
    p.add_argument('--bankruptcy-amount', type=float, default=None, help='破产财产总额')
    # 公证费
    p.add_argument('--notary', action='store_true', help='启用公证费估算')
    p.add_argument('--notary-mode', default='evidence',
                   choices=['property', 'contract', 'evidence', 'document', 'lump'],
                   help='公证费计算方式(默认evidence证据保全)')
    p.add_argument('--notary-amount', type=float, default=None, help='公证费计费基数(默认=amount)')
    p.add_argument('--notary-fee', type=float, default=None, help='公证费直接给定(手动，优先于mode)')
    # 律师费
    p.add_argument('--lawyer', action='store_true', help='启用律师费估算')
    p.add_argument('--lawyer-mode', default='guide', choices=['guide', 'risk', 'lump'])
    p.add_argument('--lawyer-amount', type=float, default=None, help='律师费计费基数(默认=amount)')
    p.add_argument('--lawyer-base', type=float, default=LAWYER_BASE_FLOOR, help='律师基础费下限')
    p.add_argument('--lawyer-lump', type=float, default=None, help='计件律师费')
    p.add_argument('--lawyer-risk-rate', type=float, default=RISK_AGENCY_CAP, help='风险代理比例')
    # 其他市场化费用
    p.add_argument('--appraisal', action='store_true', help='启用鉴定费估算')
    p.add_argument('--appraisal-type', default='document',
                   choices=['document', 'construction', 'accounting', 'other'])
    p.add_argument('--appraisal-amount', type=float, default=None, help='鉴定按标的基数')
    p.add_argument('--appraisal-fee', type=float, default=None, help='鉴定费直接给定')
    p.add_argument('--evaluation-amount', type=float, default=None, help='评估资产额')
    p.add_argument('--auction-amount', type=float, default=None, help='拍卖成交价')
    p.add_argument('--announcement', action='store_true', help='启用公告费估算')
    p.add_argument('--announcement-fee', type=float, default=600.0, help='公告费(默认600/次)')
    p.add_argument('--translation-words', type=float, default=None, help='翻译字数(涉外)')
    p.add_argument('--translation-rate', type=float, default=300.0, help='翻译费率(元/千字)')
    p.add_argument('--travel-fee', type=float, default=None, help='差旅费估算')

    p.add_argument('--json', action='store_true', help='输出 JSON')
    args = p.parse_args()

    r = calculate(args)

    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return

    print('=' * 54)
    print('诉讼费用测算结果（法定 + 全面维权成本估算）')
    print('=' * 54)
    print(f'案件类型 : {r["case_type"]}    适用标准 : {r["locality"]}')
    if r['half_applied']:
        print(f'减半情形 : {r["half_applied"]}')
    print('-' * 54)
    _print_section('【一、法院诉讼费（法定）】', r['court_fee_items'])
    print(f'{"法院诉讼费小计":<44} ¥{r["court_fee_total"]:,.2f}')
    print()
    _print_section('【二、其他诉讼相关费用（市场化·估算）】', r['other_cost_items'])
    print(f'{"其他费用小计":<44} ¥{r["other_cost_total"]:,.2f}')
    print('=' * 54)
    print(f'{"合计（法定+估算）":<44} ¥{r["grand_total"]:,.2f}')
    print('=' * 54)
    print('注：法院诉讼费为权威计算；律师费/保险费/公证费/鉴定费/评估费/拍卖费/')
    print('　公告费/翻译费/差旅费为估算，以实际委托合同与票据为准；证人·鉴定人·')
    print('　翻译人·理算人出庭费及卷宗复制工本费于实际发生时另计。')


if __name__ == '__main__':
    main()
