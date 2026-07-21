#!/usr/bin/env python3
"""飞书表格数据提取工具 - 从飞书知识库表格中提取缺陷数据"""

import requests
import os
import json
import argparse
import time

import sys
sys.path.insert(0, os.path.dirname(__file__))
from utils import load_config, build_defect_data, save_results

def get_tenant_access_token(app_id, app_secret, base_url):
    """获取飞书 tenant_access_token（有效期约 2 小时）"""
    print("\n=== 获取 tenant_access_token ===")
    url = f"{base_url}/auth/v3/tenant_access_token/internal"
    resp = requests.post(url, json={"app_id": app_id, "app_secret": app_secret})
    data = resp.json()
    if data.get("code") != 0:
        print(f"❌ 获取token失败: {data}")
        return None
    token = data["tenant_access_token"]
    expire = data.get("expire", 7200)
    print(f"✅ Token获取成功（有效期 {expire} 秒）")
    return token, expire

def get_spreadsheet_token_from_wiki(token, wiki_token, base_url):
    """通过 wiki node token 获取表格 token"""
    print(f"\n=== 从知识库获取表格token ===")
    url = f"{base_url}/wiki/v2/spaces/get_node"
    resp = requests.get(url, 
        headers={"Authorization": f"Bearer {token}"},
        params={"token": wiki_token}
    )
    data = resp.json()
    if data.get("code") != 0:
        print(f"❌ 获取wiki节点失败: {data}")
        return None
    node_info = data.get("data", {}).get("node", {})
    obj_token = node_info.get("obj_token")
    obj_type = node_info.get("obj_type")
    print(f"✅ 节点类型: {obj_type}, token: {obj_token}")
    return obj_token

def get_sheet_list(token, spreadsheet_token, base_url):
    """获取表格中的所有工作表"""
    print(f"\n=== 获取工作表列表 ===")
    url = f"{base_url}/sheets/v3/spreadsheets/{spreadsheet_token}/sheets/query"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    data = resp.json()
    if data.get("code") != 0:
        print(f"❌ 获取工作表失败: {data}")
        return []
    sheets = data.get("data", {}).get("sheets", [])
    for sheet in sheets:
        print(f"  📋 工作表: {sheet.get('title')} (sheet_id: {sheet.get('sheet_id')})")
    return sheets

def find_column_indices(token, spreadsheet_token, sheet_id, column_names, base_url):
    """根据列名找到列索引"""
    print(f"\n=== 查找列索引 ===")
    url = f"{base_url}/sheets/v2/spreadsheets/{spreadsheet_token}/values/{sheet_id}!A1:Z1"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    data = resp.json()
    if data.get("code") != 0:
        print(f"❌ 读取表头失败: {data}")
        return {}
    
    headers = data.get("data", {}).get("valueRange", {}).get("values", [[]])[0]
    indices = {}
    for name, col_name in column_names.items():
        try:
            idx = headers.index(col_name)
            indices[name] = idx
            print(f"  {name}: 列{chr(65+idx)} (索引{idx}) = '{col_name}'")
        except ValueError:
            print(f"  ⚠️ 列 '{col_name}' 未找到，跳过 {name}")
    
    return indices

def read_sheet_data(token, spreadsheet_token, sheet_id, column_indices, base_url):
    """读取工作表数据"""
    print(f"\n=== 读取工作表数据 ===")
    url = f"{base_url}/sheets/v2/spreadsheets/{spreadsheet_token}/values/{sheet_id}!A1:Z500"
    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"})
    data = resp.json()
    if data.get("code") != 0:
        print(f"❌ 读取数据失败: {data}")
        return []
    
    rows = data.get("data", {}).get("valueRange", {}).get("values", [])
    print(f"  📊 共读取到 {len(rows)} 行数据")
    
    defects = []
    for row_idx, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        
        defect = {"row": row_idx}
        has_data = False
        
        for field, col_idx in column_indices.items():
            if col_idx < len(row):
                cell = row[col_idx]
                if isinstance(cell, list):
                    texts = []
                    images = []
                    for item in cell:
                        if isinstance(item, dict):
                            if item.get("type") in ("embed-image", "image", "img"):
                                images.append(item)
                                if not defect.get("_diag_img"):
                                    print(f"  🔍 [诊断] row{row_idx} {field} 图片结构: {json.dumps(item, ensure_ascii=False)[:250]}")
                                    defect["_diag_img"] = True
                            elif item.get("type") == "url":
                                texts.append(item.get("link", ""))
                            elif item.get("type") == "text":
                                texts.append(item.get("text", ""))
                    defect[field] = "\n".join(texts) if texts else ""
                    if images:
                        defect[f"{field}_images"] = images
                elif isinstance(cell, dict):
                    if cell.get("type") in ("embed-image", "image", "img"):
                        defect[field] = ""
                        defect[f"{field}_images"] = [cell]
                    else:
                        defect[field] = str(cell)
                else:
                    defect[field] = str(cell) if cell else ""
                
                if defect[field]:
                    has_data = True
            else:
                defect[field] = ""
        
        if has_data and defect.get("description"):
            defects.append(defect)
    
    print(f"  ✅ 共提取 {len(defects)} 条缺陷数据")
    return defects

def download_images(token, defects, output_dir, base_url):
    """下载所有图片"""
    print(f"\n=== 下载图片 ===")
    os.makedirs(output_dir, exist_ok=True)
    
    image_count = 0
    for defect in defects:
        for field in ["screenshot", "design_ref"]:
            images = defect.get(f"{field}_images", [])
            downloaded = []
            for img in images:
                file_token = (img.get("fileToken") or img.get("token")
                              or (img.get("img") or {}).get("token")
                              or (img.get("img") or {}).get("fileToken") or "")
                if file_token:
                    row = defect["row"]
                    filename = f"r{row}_{field}_{file_token[:12]}.png"
                    filepath = os.path.join(output_dir, filename)
                    
                    url = f"{base_url}/drive/v1/medias/{file_token}/download"
                    resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, stream=True)
                    
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                f.write(chunk)
                        downloaded.append(filename)
                        image_count += 1
                        print(f"  ✅ {filename}")
                    else:
                        print(f"  ❌ 下载失败: {file_token}")
                    
                    time.sleep(0.3)
            
            if downloaded:
                defect[f"{field}_files"] = downloaded
    
    print(f"  共下载 {image_count} 张图片")
    return defects

def main():
    parser = argparse.ArgumentParser(description="从飞书表格提取缺陷数据")
    parser.add_argument("--wiki-token", required=True, help="飞书 wiki token")
    parser.add_argument("--config", default="config.yaml", help="配置文件路径")
    parser.add_argument("--output", default="pending_defects.json", help="输出文件路径")
    parser.add_argument("--images-dir", default="images", help="图片输出目录")
    args = parser.parse_args()
    
    config = load_config(args.config)
    api_config = config.get("feishu_api", {})
    base_url = api_config.get("base_url", "https://open.feishu.cn/open-apis")
    
    token_info = get_tenant_access_token(
        api_config.get("app_id"),
        api_config.get("app_secret"),
        base_url
    )
    if not token_info:
        return
    token, expire = token_info
    token_start = time.time()
    
    spreadsheet_token = get_spreadsheet_token_from_wiki(token, args.wiki_token, base_url)
    if not spreadsheet_token:
        return
    
    sheets = get_sheet_list(token, spreadsheet_token, base_url)
    if not sheets:
        return
    
    sheet_id = sheets[0].get("sheet_id")
    column_names = config.get("column_mapping", config.get("feishu_columns", {}))
    column_indices = find_column_indices(token, spreadsheet_token, sheet_id, column_names, base_url)
    defects = read_sheet_data(token, spreadsheet_token, sheet_id, column_indices, base_url)
    
    # 下载图片前检查 token 是否即将过期（预留 10 分钟缓冲）
    elapsed = time.time() - token_start
    if elapsed > (expire - 600):
        print("\n⚠️ Token 即将过期，正在刷新...")
        new_token_info = get_tenant_access_token(
            api_config.get("app_id"),
            api_config.get("app_secret"),
            base_url
        )
        if new_token_info:
            token, expire = new_token_info
            token_start = time.time()
            print("✅ Token 已刷新")
    
    defects = download_images(token, defects, args.images_dir, base_url)
    results = build_defect_data(defects, config)
    
    save_results(results, args.output)
    
    print(f"\n=== 完成 ===")
    print(f"✅ 图片已保存到: {args.images_dir}/")
    print(f"共 {len(results)} 条缺陷待创建")

if __name__ == "__main__":
    main()
