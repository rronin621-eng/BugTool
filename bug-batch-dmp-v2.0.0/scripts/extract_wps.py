#!/usr/bin/env python3
"""金山文档（WPS）数据提取工具 - 从金山文档在线表格中提取缺陷数据

用法：
    python scripts/extract_wps.py --doc-url "https://kdocs.cn/l/xxx" --config config.yaml

前置条件：
    1. 在 WPS 开放平台创建应用，获取 client_id 和 client_secret
    2. 在 config.yaml 中配置 wps_api 部分
    3. 确保文档已授权给应用
"""

import os
import sys
import argparse
import requests
import time

sys.path.insert(0, os.path.dirname(__file__))
from utils import load_config, build_defect_data, save_results


def get_access_token(client_id, client_secret):
    """获取 WPS 开放平台 access_token
    
    参考文档：https://open.wps.cn/docs/openapi/oauth
    """
    print("\n=== 获取 access_token ===")
    url = "https://solution.wps.cn/api/oauth2/token"
    resp = requests.post(url, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "grant_type": "client_credentials"
    })
    data = resp.json()
    if "access_token" not in data:
        print(f"❌ 获取 token 失败: {data}")
        return None
    print(f"✅ Token 获取成功")
    return data["access_token"]


def get_sheet_data(token, file_id, sheet_id):
    """读取金山文档工作表数据
    
    参考文档：https://open.wps.cn/docs/openapi/sheet
    """
    print(f"\n=== 读取工作表数据 ===")
    url = f"https://solution.wps.cn/api/file/v1/files/{file_id}/sheets/{sheet_id}/range/A1:Z500"
    headers = {"Authorization": f"Bearer {token}"}
    
    resp = requests.get(url, headers=headers)
    data = resp.json()
    
    if data.get("code") != 0:
        print(f"❌ 读取数据失败: {data}")
        return []
    
    rows = data.get("data", {}).get("values", [])
    print(f"  📊 共读取到 {len(rows)} 行数据")
    return rows


def find_column_indices(rows, column_names):
    """根据列名找到列索引"""
    print(f"\n=== 查找列索引 ===")
    if not rows:
        return {}
    
    headers = [str(cell).strip() if cell else "" for cell in rows[0]]
    indices = {}
    for name, col_name in column_names.items():
        try:
            idx = headers.index(col_name)
            indices[name] = idx
            print(f"  {name}: 列{chr(65+idx)} = '{col_name}'")
        except ValueError:
            print(f"  ⚠️ 列 '{col_name}' 未找到，跳过 {name}")
    
    return indices


def extract_file_id_from_url(url):
    """从金山文档 URL 中提取 file_id"""
    import re
    # https://kdocs.cn/l/xxxxx
    match = re.search(r'kdocs\.cn/l/([A-Za-z0-9]+)', url)
    if match:
        return match.group(1)
    return url


def download_images(token, defects, output_dir):
    """下载缺陷中的图片"""
    print(f"\n=== 下载图片 ===")
    os.makedirs(output_dir, exist_ok=True)
    
    image_count = 0
    for defect in defects:
        for field in ["screenshot", "design_ref"]:
            urls = defect.get(f"{field}_urls", [])
            downloaded = []
            for i, url in enumerate(urls):
                if not url:
                    continue
                row = defect["row"]
                filename = f"r{row}_{field}_{i}.png"
                filepath = os.path.join(output_dir, filename)
                
                try:
                    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                                       stream=True, timeout=30)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                f.write(chunk)
                        downloaded.append(filename)
                        image_count += 1
                except Exception as e:
                    print(f"  ❌ 下载失败: {e}")
                
                time.sleep(0.3)
            
            if downloaded:
                defect[f"{field}_files"] = downloaded
    
    print(f"  共下载 {image_count} 张图片")
    return defects


def main():
    parser = argparse.ArgumentParser(description="从金山文档提取缺陷数据")
    parser.add_argument("--doc-url", required=True, help="金山文档 URL 或 file_id")
    parser.add_argument("--config", default="config.yaml", help="配置文件路径")
    parser.add_argument("--output", default="pending_defects.json", help="输出文件路径")
    parser.add_argument("--images-dir", default="images", help="图片输出目录")
    args = parser.parse_args()
    
    config = load_config(args.config)
    api_config = config.get("wps_api", {})
    
    client_id = api_config.get("client_id")
    client_secret = api_config.get("client_secret")
    
    if not client_id or not client_secret:
        print("❌ 请在 config.yaml 中配置 wps_api.client_id 和 client_secret")
        return
    
    token = get_access_token(client_id, client_secret)
    if not token:
        return
    
    file_id = extract_file_id_from_url(args.doc_url)
    print(f"  📄 文档 ID: {file_id}")
    
    # TODO: 获取工作表列表，取第一个
    sheet_id = "Sheet1"
    
    rows = get_sheet_data(token, file_id, sheet_id)
    if not rows:
        print("❌ 未读取到数据")
        return
    
    column_names = config.get("column_mapping", config.get("feishu_columns", {}))  # 复用同一套列名映射
    column_indices = find_column_indices(rows, column_names)
    
    # 解析数据行
    defects = []
    for row_idx, row in enumerate(rows[1:], start=2):
        values = [str(cell).strip() if cell else "" for cell in row]
        if not any(values):
            continue
        
        defect = {"row": row_idx}
        has_data = False
        for field, col_idx in column_indices.items():
            if col_idx < len(values):
                defect[field] = values[col_idx]
                if defect[field]:
                    has_data = True
            else:
                defect[field] = ""
        
        if has_data and defect.get("description"):
            defects.append(defect)
    
    print(f"  ✅ 共提取 {len(defects)} 条缺陷数据")
    
    defects = download_images(token, defects, args.images_dir)
    results = build_defect_data(defects, config)
    
    save_results(results, args.output)
    
    print(f"\n=== 完成 ===")
    print(f"✅ 共 {len(results)} 条缺陷待创建")


if __name__ == "__main__":
    main()
