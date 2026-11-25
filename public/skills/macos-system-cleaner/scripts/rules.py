#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""规则库加载器：所有扫描策略数据都来自 rules/*.json，本模块不含规则副本。

用法：
    rules = load_rules()                  # 默认 <skill>/rules
    rules = load_rules("/my/rules")       # 用户自定义目录（无 manifest 也允许）
    ctx = make_context(mac, mail_v)
    cats = [resolve_category(c, ctx, rules, mac) for c in rules["categories"]["categories"]]
"""
import os
import re
import sys
import json
import hashlib
import tempfile

HOME = os.path.expanduser("~")
DEFAULT_RULES_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rules"))
SCHEMA_VERSION = 1
RULE_FILES = ("defaults.json", "collectors.json", "clutter.json", "categories.json")
KEY_TO_FILE = {
    "defaults": "defaults", "collectors": "collectors",
    "clutter": "clutter", "categories": "categories",
}


class RuleError(Exception):
    pass


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as ex:
        raise RuleError("规则文件读取失败 %s: %s" % (path, ex))


def _verify(dirpath):
    """默认规则目录必须有 manifest 且逐文件校验；自定义目录允许缺失。"""
    mf = os.path.join(dirpath, "manifest.json")
    if not os.path.isfile(mf):
        return None
    man = _read_json(mf)
    files = man.get("files") or {}
    for name, expected in files.items():
        path = os.path.join(dirpath, name)
        if not os.path.isfile(path):
            raise RuleError("规则文件缺失: %s" % name)
        with open(path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        if digest != expected:
            raise RuleError("规则文件校验失败（可能被改动）: %s" % name)
    return man


def load_rules(dirpath=None):
    """载入规则库。返回 dict，含 _dir / _manifest 元信息。"""
    d = os.path.abspath(os.path.expanduser(dirpath or DEFAULT_RULES_DIR))
    if not os.path.isdir(d):
        raise RuleError("规则目录不存在: %s" % d)
    man = _verify(d)
    rules = {}
    for name in RULE_FILES:
        path = os.path.join(d, name)
        if not os.path.isfile(path):
            raise RuleError("规则文件缺失: %s" % name)
        data = _read_json(path)
        if data.get("schema_version") != SCHEMA_VERSION:
            raise RuleError("%s schema_version 不匹配（期望 %d）"
                            % (name, SCHEMA_VERSION))
        rules[name[:-5]] = data
    rules["_dir"] = d
    rules["_manifest"] = man
    return rules


def make_context(mac=None, mail_v=None, rules=None):
    """构造占位符上下文。路径占位符在 resolve 时展开。"""
    ctx = {
        "HOME": HOME,
        "CACHE_HOME": os.path.join(HOME, "Library", "Caches"),
        "TMP": tempfile.gettempdir(),
        "UID": str(os.getuid()),
    }
    if mac:
        ctx.update({
            "FAMILY": mac.get("family", ""),
            "MAJOR_NUM": mac.get("major_num", 0),
            "APPLE_SILICON": bool(mac.get("apple_silicon")),
            "SEALED": bool(mac.get("sealed_system")),
        })
    if mail_v:
        ctx["MAIL_V"] = mail_v
    if rules and rules["defaults"].get("mail_v") and mac:
        ctx.setdefault("MAIL_V_FALLBACK",
                       rules["defaults"]["mail_v"].get(
                           mac.get("family", ""),
                           rules["defaults"]["mail_v_default"]))
    return ctx


def _lookup(rules, key):
    if key == "DEV_BASES":
        return ["{HOME}/" + d for d in rules["defaults"]["dev_dirs"]]
    for group in ("defaults", "collectors", "clutter", "categories"):
        if key in rules.get(group, {}):
            return rules[group][key]
    return None


def _when_ok(when, mac):
    if not when:
        return True
    if not mac:
        return False
    for k, v in when.items():
        if k == "apple_silicon":
            if bool(mac.get("apple_silicon")) != bool(v):
                return False
        elif k == "sealed":
            if bool(mac.get("sealed_system")) != bool(v):
                return False
        elif k == "major_min":
            if float(mac.get("major_num", 0)) < float(v):
                return False
        elif k == "major_max":
            if float(mac.get("major_num", 0)) > float(v):
                return False
        else:
            raise RuleError("未知条件: %s" % k)
    return True


def resolve(obj, ctx, rules=None, mac=None):
    """展开字符串占位符 / @引用 / 条件项。条件不满足的项返回 None 并被列表剔除。"""
    if isinstance(obj, str):
        s = obj
        if s.startswith("@"):
            if rules is None:
                raise RuleError("使用 @引用时必须传入 rules")
            found = _lookup(rules, s[1:])
            if found is None:
                raise RuleError("未知规则引用: %s" % s)
            return resolve(found, ctx, rules, mac)
        try:
            return s.format(**ctx)
        except KeyError as ex:
            raise RuleError("规则占位符未定义: %s (%s)" % (s, ex))
    if isinstance(obj, list):
        out = []
        for item in obj:
            val = resolve(item, ctx, rules, mac)
            if val is not None:
                out.append(val)
        return out
    if isinstance(obj, dict):
        if "path" in obj and "when" in obj:
            if not _when_ok(obj["when"], mac):
                return None
            return resolve(obj["path"], ctx, rules, mac)
        return {k: resolve(v, ctx, rules, mac) for k, v in obj.items()}
    return obj


def resolve_category(cat, ctx, rules, mac):
    """解析单个类目；条件不满足返回 None。"""
    if not _when_ok(cat.get("when"), mac):
        return None
    out = resolve(cat, ctx, rules, mac)
    out.pop("when", None)
    return out


def mail_version_pattern():
    """Mail V<n> 目录名的正则（结构规则，放在规则库外属于算法常量）。"""
    return re.compile(r"V\d+")


if __name__ == "__main__":
    r = load_rules()
    c = make_context()
    print("rules dir:", r["_dir"])
    print("files:", ", ".join(RULE_FILES))
    print("categories:", len(r["categories"]["categories"]))
