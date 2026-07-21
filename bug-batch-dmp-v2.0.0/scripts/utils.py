"""共享工具函数 - 供所有数据源提取脚本复用"""

import re
import os
import json


def build_defect_data(defects, config):
    """构建最终缺陷数据（统一输出格式）
    
    Args:
        defects: 原始缺陷列表，每条需包含 module/description/progress/handler/reviewer/note/design_ref 等字段
        config: 配置字典，需含 handler_mapping 和 title_template
    
    Returns:
        统一格式的缺陷数据列表
    """
    print(f"\n=== 构建缺陷数据 ===")
    handler_mapping = config.get("handler_mapping", {})
    title_template = config.get("title_template", "【{progress}】【{module}】{description}")
    
    results = []
    for defect in defects:
        title = title_template.format(
            progress=defect.get("progress", "待修改"),
            module=defect.get("module", ""),
            description=defect.get("description", "")
        )
        
        original_note = defect.get("note", "")
        reviewer = defect.get("reviewer", "")
        design_ref_text = defect.get("design_ref", "")
        
        note_parts = []
        if original_note:
            note_parts.append(original_note)
        if reviewer:
            note_parts.append(f"走查人{reviewer}")
        if design_ref_text:
            note_parts.append(f"设计稿参考: {design_ref_text}")
        
        note = "\n".join(note_parts)
        
        handler_raw = defect.get("handler", "")
        # 支持多人处理人：按顿号、逗号、斜杠分割，取第一人
        handler_names = re.split(r'[、,，/]', handler_raw)
        handler_name = handler_names[0].strip() if handler_names else ""
        handler_id = handler_mapping.get(handler_name, handler_mapping.get("default", ""))
        # 如果第一人找不到，尝试后续人
        if not handler_id:
            for name in handler_names[1:]:
                name = name.strip()
                hid = handler_mapping.get(name, "")
                if hid:
                    handler_name = name
                    handler_id = hid
                    break
        # 兜底：仍找不到则用默认处理人
        if not handler_id:
            handler_name = handler_mapping.get("default", "")
            handler_id = handler_mapping.get(handler_name, "")
        
        result = {
            "row": defect["row"],
            "module": defect.get("module", ""),
            "title": title,
            "desc": defect.get("description", ""),
            "handler_name": handler_name,
            "handler_id": handler_id,
            "note": note,
            "screenshot_files": defect.get("screenshot_files", []),
            "design_ref_files": defect.get("design_ref_files", [])
        }
        results.append(result)
    
    print(f"  ✅ 共构建 {len(results)} 条缺陷数据")
    return results


def save_results(results, output_path):
    """保存缺陷数据到 JSON 文件"""
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"  ✅ 缺陷数据已保存到: {output_path}")


def load_config(config_path):
    """加载 YAML 配置文件"""
    import yaml
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)
