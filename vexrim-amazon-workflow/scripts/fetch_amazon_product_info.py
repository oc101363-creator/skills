#!/usr/bin/env python3
"""
Amazon 产品信息抓取脚本
提取标题、品牌、价格、卖点、描述、技术参数等文本信息。

用法：
  python3 fetch_amazon_product_info.py --urls URL1 URL2 ... --output-dir /path/to/output
  python3 fetch_amazon_product_info.py --from-bitable --output-dir /path/to/output
"""

import argparse
import html
import json
import os
import re
import subprocess
import time
from pathlib import Path

CURL_HEADERS = [
    "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H", "Accept-Language: en-US,en;q=0.9",
    "-H", "Accept-Encoding: gzip, deflate, br",
    "-H", "DNT: 1",
    "-H", "Connection: keep-alive",
    "-H", "Upgrade-Insecure-Requests: 1",
]

# 配置项：可通过环境变量覆盖，保留本地默认值作为 fallback
BASE_TOKEN = os.environ.get("LARK_BASE_TOKEN", "XHuAbV2ZeaeFFOsc4f7cpY3VnD5")
PROD_TABLE = os.environ.get("LARK_PROD_TABLE", "tblBq6bCCqH6E7IL")
LARK_CLI_PATH = os.environ.get("LARK_CLI_PATH", "/Users/mingkaichen/项目/亚马逊工作流/lark-cli/node_modules/.bin")


def run_cmd(args_list):
    env = os.environ.copy()
    env["PATH"] = LARK_CLI_PATH + ":" + env.get("PATH", "")
    result = subprocess.run(args_list, capture_output=True, text=True, env=env)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "raw": result.stdout[:500], "err": result.stderr[:500]}


def extract_asin(url):
    m = re.search(r'/dp/([A-Z0-9]{10})', url)
    return m.group(1) if m else None


def fetch_html_with_curl(url):
    """使用 curl 获取页面 HTML"""
    cmd = ["curl", "-s", "-L", "--compressed"] + CURL_HEADERS + [url]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"  curl error: {result.stderr[:200]}")
        return None
    return result.stdout


def clean_text(text):
    """清理提取的文本"""
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    text = html.unescape(text)
    return text.strip()


def extract_product_info(html):
    """从 HTML 中提取产品信息"""
    if not html:
        return {}

    info = {}

    # 1. 标题
    title_match = re.search(r'<span[^>]*id=["\']productTitle["\'][^>]*>(.*?)</span>', html, re.DOTALL)
    if title_match:
        info["title"] = clean_text(title_match.group(1))

    # 2. 品牌
    brand_match = re.search(r'<a[^>]*id=["\']bylineInfo["\'][^>]*>(.*?)</a>', html, re.DOTALL)
    if not brand_match:
        brand_match = re.search(r'<span[^>]*class=["\']po-brand["\'][^>]*>.*?<span[^>]*class=["\']a-size-base["\'][^>]*>(.*?)</span>', html, re.DOTALL)
    if brand_match:
        info["brand"] = clean_text(brand_match.group(1)).replace("Visit the ", "").replace(" Store", "")

    # 3. 价格
    price_match = re.search(r'<span[^>]*class=["\']a-price["\'][^>]*>.*?<span[^>]*class=["\']a-offscreen["\'][^>]*>(.*?)</span>', html, re.DOTALL)
    if price_match:
        info["price"] = clean_text(price_match.group(1))
    else:
        price_match = re.search(r'<span[^>]*class=["\']a-price-whole["\'][^>]*>(.*?)</span>', html, re.DOTALL)
        if price_match:
            info["price"] = re.sub(r'\s+\.', '.', clean_text(price_match.group(1)))

    # 4. Bullet Points（卖点）
    bullets = []
    bp_match = re.search(r'<div[^>]*id=["\']feature-bullets["\'][^>]*>(.*?)</div>\s*</div>', html, re.DOTALL)
    if bp_match:
        bp_html = bp_match.group(1)
        for li in re.findall(r'<li[^>]*>.*?<span[^>]*class=["\']a-list-item["\'][^>]*>(.*?)</span>.*?</li>', bp_html, re.DOTALL):
            text = clean_text(li)
            if text and not text.startswith("Make sure") and not text.startswith("【"):
                bullets.append(text)
    info["bullet_points"] = bullets

    # 5. 产品描述
    desc_match = re.search(r'<div[^>]*id=["\']productDescription["\'][^>]*>(.*?)</div>\s*</div>', html, re.DOTALL)
    if desc_match:
        desc_html = desc_match.group(1)
        desc_parts = []
        for p in re.findall(r'<p[^>]*>(.*?)</p>', desc_html, re.DOTALL):
            text = clean_text(p)
            if text:
                desc_parts.append(text)
        info["description"] = "\n".join(desc_parts)

    # 6. 技术参数
    tech_specs = {}
    # 方式1: productDetails_techSpec_section_1 (旧版页面)
    tech_match = re.search(r'<table[^>]*id=["\']productDetails_techSpec_section_1["\'][^>]*>(.*?)</table>', html, re.DOTALL)
    if tech_match:
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', tech_match.group(1), re.DOTALL):
            tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
            if len(tds) >= 2:
                key = clean_text(tds[0])
                val = clean_text(tds[1])
                if key and val:
                    tech_specs[key] = val
    # 方式2: 整页搜索 a-keyvalue prodDetTable (新版页面，<th> 为 key，<td> 为 value)
    if not tech_specs:
        for table_html in re.findall(r'<table[^>]*class=["\'][^"\']*prodDetTable[^"\']*["\'][^>]*>(.*?)</table>', html, re.DOTALL):
            for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL):
                ths = re.findall(r'<th[^>]*>(.*?)</th>', tr, re.DOTALL)
                tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
                if ths and tds:
                    key = clean_text(ths[0])
                    val = clean_text(tds[0])
                    if key and val:
                        tech_specs[key] = val
                elif len(tds) >= 2:
                    key = clean_text(tds[0])
                    val = clean_text(tds[1])
                    if key and val:
                        tech_specs[key] = val
    info["tech_specs"] = tech_specs

    # 7. 更多信息（More Details）
    more_details = {}
    # 旧版: productDetails_detailBullets_sections1
    more_match = re.search(r'<table[^>]*id=["\']productDetails_detailBullets_sections1["\'][^>]*>(.*?)</table>', html, re.DOTALL)
    if not more_match:
        # 新版: detailBullets 或 productDetails 外的其他表格
        more_match = re.search(r'<div[^>]*id=["\']detailBullets_feature_div["\'][^>]*>(.*?)</div>\s*</div>', html, re.DOTALL)
    if more_match:
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', more_match.group(1), re.DOTALL):
            tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
            if len(tds) >= 2:
                key = clean_text(tds[0])
                val = clean_text(tds[1])
                if key and val:
                    more_details[key] = val
    info["more_details"] = more_details

    return info


def get_urls_from_bitable():
    """从产品任务表获取所有有 Amazon 链接的记录"""
    resp = run_cmd([
        "lark-cli", "base", "+record-list",
        "--base-token", BASE_TOKEN,
        "--table-id", PROD_TABLE,
        "--limit", "500"
    ])
    if not resp.get("ok"):
        print("Failed to fetch Bitable records:", resp)
        return []

    data = resp["data"]
    fields = data["fields"]
    name_idx = fields.index("5.26")

    # 找所有可能的链接字段
    link_fields = []
    for i, f in enumerate(fields):
        if "链接" in f or "URL" in f or "url" in f or "Link" in f:
            link_fields.append(i)

    results = []
    for rid, row in zip(data["record_id_list"], data["data"]):
        name = row[name_idx]
        if isinstance(name, list) and name:
            name = name[0]

        for li in link_fields:
            link = row[li]
            url = None
            if isinstance(link, list) and link:
                link = link[0]
            if isinstance(link, str):
                m = re.search(r'\((https://[^\)]+)\)', link)
                if m:
                    url = m.group(1)
                elif link.startswith("http"):
                    url = link
            if url and 'amazon.com' in url:
                results.append((str(name) if name else rid, url))
                break

    return results


def get_vexrim_urls_from_bitable():
    """从产品任务表获取 Vexrim链接 字段里的 Amazon 链接"""
    resp = run_cmd([
        "lark-cli", "base", "+record-list",
        "--base-token", BASE_TOKEN,
        "--table-id", PROD_TABLE,
        "--limit", "500"
    ])
    if not resp.get("ok"):
        print("Failed to fetch Bitable records:", resp)
        return []

    data = resp["data"]
    fields = data["fields"]
    name_idx = fields.index("5.26")

    vexrim_field = None
    for i, f in enumerate(fields):
        if f == "Vexrim链接":
            vexrim_field = i
            break

    if vexrim_field is None:
        print("未找到 'Vexrim链接' 字段")
        return []

    results = []
    for rid, row in zip(data["record_id_list"], data["data"]):
        name = row[name_idx]
        if isinstance(name, list) and name:
            name = name[0]

        link = row[vexrim_field]
        url = None
        if isinstance(link, list) and link:
            link = link[0]
        if isinstance(link, str):
            m = re.search(r'\((https://[^\)]+)\)', link)
            if m:
                url = m.group(1)
            elif link.startswith("http"):
                url = link

        if url and 'amazon.com' in url:
            results.append((str(name) if name else rid, url))

    return results


def main():
    parser = argparse.ArgumentParser(description='Amazon 产品信息抓取脚本')
    parser.add_argument('--urls', nargs='*', help='直接传入 Amazon 商品 URL')
    parser.add_argument('--from-bitable', action='store_true', help='从产品任务表获取链接')
    parser.add_argument('--vexrim', action='store_true', help='只抓取 Vexrim链接 字段的产品')
    parser.add_argument('--output-dir', default='/Users/mingkaichen/项目/image2/product_info', help='输出目录')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.urls:
        targets = [(extract_asin(u) or f"url_{i+1}", u) for i, u in enumerate(args.urls)]
    elif args.vexrim:
        targets = get_vexrim_urls_from_bitable()
        print(f"从 Vexrim链接 字段获取到 {len(targets)} 个链接")
    elif args.from_bitable:
        targets = get_urls_from_bitable()
        print(f"从产品任务表获取到 {len(targets)} 个链接")
    else:
        print("请使用 --urls 传入链接，或加上 --from-bitable / --vexrim 从 Bitable 获取")
        return

    for i, (name, url) in enumerate(targets):
        asin = extract_asin(url)
        label = f"{i+1:02d}_{asin or 'unknown'}"
        safe_name = "".join(c for c in name if c.isalnum() or c in " _-").strip()
        url_dir = output_dir / safe_name
        url_dir.mkdir(exist_ok=True)

        print(f"\n[{i+1}/{len(targets)}] {safe_name} ({asin or 'unknown'})")

        html = fetch_html_with_curl(url)
        if html is None:
            print("  获取页面失败，跳过")
            continue

        info = extract_product_info(html)
        info["asin"] = asin
        info["url"] = url
        info["source_name"] = name

        # 保存 JSON
        json_path = url_dir / "info.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False, indent=2)
        print(f"  已保存: {json_path}")

        # 打印关键信息
        if "title" in info:
            print(f"  标题: {info['title'][:80]}...")
        if "price" in info:
            print(f"  价格: {info['price']}")
        if "bullet_points" in info:
            print(f"  卖点: {len(info['bullet_points'])} 条")
        if "tech_specs" in info:
            print(f"  参数: {len(info['tech_specs'])} 项")

        if i < len(targets) - 1:
            delay = 3 + (hash(url) % 50) / 10
            time.sleep(delay)

    print(f"\n全部完成！信息保存在: {output_dir}")


if __name__ == "__main__":
    main()
