#!/usr/bin/env python3
"""
Amazon 竞品参考图片抓取脚本（无 Playwright 版）
使用 curl 获取页面，解析 colorImages 数据提取高清图片。

用法：
  python3 fetch_amazon_images.py --urls URL1 URL2 ... --output-dir /path/to/output
  python3 fetch_amazon_images.py --from-bitable --output-dir /path/to/output
"""

import argparse
import json
import os
import re
import ssl
import subprocess
import time
import urllib.request
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
REF_TABLE = os.environ.get("LARK_REF_TABLE", "tblZHhl9ErCQoyr8")
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
    """使用 curl 获取页面 HTML（绕过亚马逊 requests 拦截）"""
    cmd = ["curl", "-s", "-L", "--compressed"] + CURL_HEADERS + [url]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"  curl error: {result.stderr[:200]}")
        return None
    return result.stdout


def extract_image_urls(html):
    """从 HTML 中提取 colorImages 的高清图片 URL"""
    if not html:
        return []

    # 策略1: 直接搜索 colorImages 中的 hiRes
    pattern = r'"hiRes"\s*:\s*"(https://m\.media-amazon\.com/images/I/[^"]+?)"'
    urls = re.findall(pattern, html)

    # 策略2: 如果策略1没找到，尝试从 colorImages initial 提取
    if not urls:
        m = re.search(r"'colorImages'\s*:\s*(\{.*?\"initial\"\s*:\s*\[.*?\]\s*\})", html, re.DOTALL)
        if m:
            raw = m.group(1)
            # 安全提取 hiRes URL
            urls = re.findall(r'"hiRes"\s*:\s*"(https://m\.media-amazon\.com/images/I/[^"]+?)"', raw)

    # 去重并保持顺序
    seen = set()
    result = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            result.append(u)
    return result


def download_image(url, save_path, retries=2):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.amazon.com/',
    }
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
                save_path.write_bytes(resp.read())
            return True
        except Exception as e:
            if attempt < retries:
                time.sleep(2 ** attempt)
            else:
                print(f"  DOWNLOAD ERROR {url}: {e}")
                return False


def get_urls_from_bitable():
    """从竞品参考表获取所有 Amazon 链接"""
    resp = run_cmd([
        "lark-cli", "base", "+record-list",
        "--base-token", BASE_TOKEN,
        "--table-id", REF_TABLE,
        "--limit", "500"
    ])
    if not resp.get("ok"):
        print("Failed to fetch Bitable records:", resp)
        return []

    data = resp["data"]
    fields = data["fields"]
    link_idx = fields.index("参考链接")

    urls = []
    for row in data["data"]:
        link = row[link_idx]
        if link and isinstance(link, str) and 'amazon.com' in link:
            # 去掉 Markdown 链接格式如 [text](url)
            m = re.search(r'\((https://[^\)]+)\)', link)
            if m:
                urls.append(m.group(1))
            elif link.startswith("http"):
                urls.append(link)
    return list(dict.fromkeys(urls))


def main():
    parser = argparse.ArgumentParser(description='Amazon 竞品参考图片抓取脚本（curl 版）')
    parser.add_argument('--urls', nargs='*', help='直接传入 Amazon 商品 URL')
    parser.add_argument('--from-bitable', action='store_true', help='从 Bitable 竞品参考表获取链接')
    parser.add_argument('--output-dir', required=True, help='图片保存目录')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.urls:
        urls = args.urls
    elif args.from_bitable:
        urls = get_urls_from_bitable()
        print(f"从 Bitable 获取到 {len(urls)} 个链接")
    else:
        print("请使用 --urls 传入链接，或加上 --from-bitable 从 Bitable 获取")
        return

    for i, url in enumerate(urls):
        asin = extract_asin(url)
        label = f"{i+1:02d}_{asin or 'unknown'}"
        print(f"\n[{i+1}/{len(urls)}] {label}")

        url_dir = output_dir / label
        url_dir.mkdir(exist_ok=True)

        html = fetch_html_with_curl(url)
        if html is None:
            print("  获取页面失败，跳过")
            continue

        img_urls = extract_image_urls(html)
        print(f"  找到 {len(img_urls)} 张图片")

        for j, img_url in enumerate(img_urls):
            save_path = url_dir / f"img_{j+1:02d}.jpg"
            if save_path.exists():
                print(f"    [{j+1}] 已存在，跳过")
                continue
            ok = download_image(img_url, save_path)
            print(f"    [{j+1}] {'OK' if ok else 'FAIL'} → {save_path.name}")
            time.sleep(0.5)

        # URL 之间休息 3-8 秒
        if i < len(urls) - 1:
            delay = 3 + (hash(url) % 50) / 10
            time.sleep(delay)

    print(f"\n全部完成！图片保存在: {output_dir}")


if __name__ == "__main__":
    main()
