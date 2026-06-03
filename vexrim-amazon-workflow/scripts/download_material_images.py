#!/usr/bin/env python3
"""
从产品素材表下载所有附件图片，按产品名分文件夹。
用法：
  python3 download_material_images.py --output-dir /path/to/output
"""

import argparse
import json
import os
import subprocess
from pathlib import Path

# 配置项：可通过环境变量覆盖，保留本地默认值作为 fallback
BASE_TOKEN = os.environ.get("LARK_BASE_TOKEN", "XHuAbV2ZeaeFFOsc4f7cpY3VnD5")
PROD_TABLE = os.environ.get("LARK_PROD_TABLE", "tblBq6bCCqH6E7IL")
MAT_TABLE = os.environ.get("LARK_MAT_TABLE", "tblUxeD9gnajXxcJ")
LARK_CLI_PATH = os.environ.get("LARK_CLI_PATH", "/Users/mingkaichen/项目/亚马逊工作流/lark-cli/node_modules/.bin")


def run_cmd(args_list):
    env = os.environ.copy()
    env["PATH"] = LARK_CLI_PATH + ":" + env.get("PATH", "")
    result = subprocess.run(args_list, capture_output=True, text=True, env=env)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "raw": result.stdout[:500], "err": result.stderr[:500]}


def get_all_records(table_id):
    """获取表的所有记录"""
    resp = run_cmd([
        "lark-cli", "base", "+record-list",
        "--base-token", BASE_TOKEN,
        "--table-id", table_id,
        "--limit", "500"
    ])
    if not resp.get("ok"):
        print(f"Failed to fetch records: {resp}")
        return None
    return resp["data"]


def download_attachment(file_token, save_path):
    """下载单个附件，save_path 为 Path 对象"""
    env = os.environ.copy()
    env["PATH"] = LARK_CLI_PATH + ":" + env.get("PATH", "")
    cmd = [
        "lark-cli", "api", "GET",
        f"/open-apis/drive/v1/medias/{file_token}/download",
        "--output", save_path.name
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(save_path.parent))
    if result.returncode != 0:
        # Check if the output contains "saved_path" indicating success
        try:
            r = json.loads(result.stdout)
            if "saved_path" in r:
                return True
        except:
            pass
        print(f"    DOWNLOAD ERROR: {result.stdout[:200]} {result.stderr[:200]}")
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description='下载产品素材表的所有附件图片')
    parser.add_argument('--output-dir', default='/Users/mingkaichen/项目/image2/materials', help='输出目录')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. 获取产品任务表记录，构建 ID → 产品名 映射
    print("获取产品任务表记录...")
    prod_data = get_all_records(PROD_TABLE)
    if not prod_data:
        return

    prod_fields = prod_data["fields"]
    # 第一个字段就是产品名（名称会变：5.26 → 6.12 → 批次）
    name_idx = 0

    id_to_name = {}
    for rid, row in zip(prod_data["record_id_list"], prod_data["data"]):
        name = row[name_idx]
        if isinstance(name, list) and name:
            name = name[0]
        if name:
            id_to_name[rid] = str(name)

    print(f"  共 {len(id_to_name)} 个产品")

    # 2. 获取产品素材表记录
    print("获取产品素材表记录...")
    mat_data = get_all_records(MAT_TABLE)
    if not mat_data:
        return

    mat_fields = mat_data["fields"]
    product_link_idx = mat_fields.index("所属产品")
    attachment_idx = mat_fields.index("素材文件")

    # 3. 解析并下载
    total_files = 0
    downloaded = 0
    skipped = 0

    for rid, row in zip(mat_data["record_id_list"], mat_data["data"]):
        # 获取关联的产品 ID
        product_links = row[product_link_idx]
        if not product_links or not isinstance(product_links, list) or len(product_links) == 0:
            continue

        prod_id = product_links[0]["id"]
        product_name = id_to_name.get(prod_id)
        if not product_name:
            print(f"  跳过记录 {rid}: 找不到产品名 (prod_id={prod_id})")
            continue

        # 获取附件
        attachments = row[attachment_idx]
        if not attachments or not isinstance(attachments, list):
            continue

        # 为产品创建文件夹
        safe_name = "".join(c for c in product_name if c.isalnum() or c in " _-").strip()
        product_dir = output_dir / safe_name
        product_dir.mkdir(exist_ok=True)

        print(f"\n{product_name} ({len(attachments)} 个文件)")

        for att in attachments:
            file_token = att["file_token"]
            file_name = att["name"]
            save_path = product_dir / file_name
            total_files += 1

            if save_path.exists() and save_path.stat().st_size > 0:
                print(f"  [跳过] {file_name}")
                skipped += 1
                continue

            if download_attachment(file_token, save_path):
                print(f"  [OK] {file_name}")
                downloaded += 1
            else:
                print(f"  [FAIL] {file_name}")

    print(f"\n全部完成！总计 {total_files} 个文件，下载 {downloaded} 个，跳过 {skipped} 个")
    print(f"保存在: {output_dir}")


if __name__ == "__main__":
    main()
