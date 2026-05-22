"""
初始化示例数据 — 首次部署时运行一次
用法: cd server && python3 seed_data.py
"""
import sqlite3
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bug_tool.db")


def ensure_tables(cursor):
    """确保所有表存在"""
    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(50) UNIQUE NOT NULL,
            display_name VARCHAR(100) NOT NULL,
            role VARCHAR(20) DEFAULT 'tester',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS inspection_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(200) NOT NULL,
            description TEXT DEFAULT '',
            status VARCHAR(20) DEFAULT 'active',
            parent_id INTEGER REFERENCES inspection_tasks(id),
            default_assignee_id INTEGER REFERENCES users(id),
            default_env_url VARCHAR(500) DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS function_modules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(200) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bugs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title VARCHAR(200) NOT NULL,
            description TEXT DEFAULT '',
            bug_type VARCHAR(20) NOT NULL,
            status VARCHAR(20) DEFAULT 'in_progress',
            priority VARCHAR(20) DEFAULT 'medium',
            reporter_id INTEGER NOT NULL REFERENCES users(id),
            assignee_id INTEGER REFERENCES users(id),
            env_url VARCHAR(500) DEFAULT '',
            inspection_task_id INTEGER REFERENCES inspection_tasks(id),
            module_id INTEGER REFERENCES function_modules(id),
            reproduction_steps TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS screenshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bug_id INTEGER REFERENCES bugs(id),
            file_path VARCHAR(500) NOT NULL,
            file_name VARCHAR(200) NOT NULL,
            file_size INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bug_collaborators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bug_id INTEGER NOT NULL REFERENCES bugs(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bug_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bug_id INTEGER NOT NULL REFERENCES bugs(id),
            from_status VARCHAR(20),
            to_status VARCHAR(20) NOT NULL,
            operator_id INTEGER NOT NULL REFERENCES users(id),
            comment TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)


def seed():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 先确保表存在
    ensure_tables(cursor)
    conn.commit()

    # 检查是否已有数据
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] > 0:
        print("  数据库已有数据，跳过初始化。")
        conn.close()
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    two_days_ago = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d %H:%M:%S")

    # ── 用户 ──
    users = [
        ("zhangsan", "张三", "tester", now),
        ("lisi", "李四", "developer", now),
        ("wangwu", "王五", "developer", now),
        ("zhaoliu", "赵六", "admin", now),
    ]
    cursor.executemany(
        "INSERT INTO users (username, display_name, role, created_at) VALUES (?, ?, ?, ?)",
        users,
    )
    print(f"  ✅ 创建 {len(users)} 个用户")

    # ── 走查项目 ──
    tasks = [
        ("Q3 产品走查", "2026年Q3产品UI走查任务", "active", None, 1, "", now),
        ("首页改版验收", "首页改版后的UI验收", "active", None, 2, "https://example.com", now),
        ("移动端适配", "移动端响应式适配检查", "active", 1, 2, "", now),
    ]
    cursor.executemany(
        "INSERT INTO inspection_tasks (name, description, status, parent_id, default_assignee_id, default_env_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        tasks,
    )
    print(f"  ✅ 创建 {len(tasks)} 个走查项目")

    # ── 功能模块 ──
    modules = [
        ("登录注册", now),
        ("首页", now),
        ("个人中心", now),
        ("订单管理", now),
    ]
    cursor.executemany(
        "INSERT INTO function_modules (name, created_at) VALUES (?, ?)",
        modules,
    )
    print(f"  ✅ 创建 {len(modules)} 个功能模块")

    # ── BUG 示例 ──
    bugs = [
        ("登录按钮在小屏幕下被截断", "按钮文字显示不全，右侧被裁切", "ui", "in_progress", "high", 1, 2, "", 1, 1, "1. 将浏览器窗口缩小到375px宽\n2. 打开登录页\n3. 观察登录按钮", two_days_ago, two_days_ago),
        ("首页轮播图加载缓慢", "首屏轮播图片加载超过3秒", "performance", "in_progress", "medium", 1, 3, "https://example.com", 2, 2, "1. 清除缓存\n2. 打开首页\n3. 观察轮播图加载时间", yesterday, yesterday),
        ("个人中心头像上传失败", "选择图片后点击上传无反应", "functional", "fixed", "high", 1, 2, "", 1, 3, "1. 进入个人中心\n2. 点击头像\n3. 选择一张图片\n4. 点击确认上传", yesterday, now),
        ("订单列表分页数据重复", "第2页和第1页显示相同数据", "functional", "in_progress", "critical", 4, 3, "", 2, 4, "1. 打开订单列表\n2. 翻到第2页\n3. 对比第1页数据", now, now),
        ("导航栏下拉菜单层级错误", "下拉菜单被其他元素遮挡", "ui", "in_progress", "medium", 1, 2, "", 1, 2, "1. 鼠标悬停导航栏\n2. 等待下拉菜单出现\n3. 观察是否被遮挡", now, now),
        ("搜索结果高亮样式丢失", "搜索关键词没有高亮显示", "ui", "closed", "low", 1, 2, "", 2, None, "", two_days_ago, yesterday),
    ]
    cursor.executemany(
        "INSERT INTO bugs (title, description, bug_type, status, priority, reporter_id, assignee_id, env_url, inspection_task_id, module_id, reproduction_steps, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        bugs,
    )
    print(f"  ✅ 创建 {len(bugs)} 条示例 BUG")

    conn.commit()
    conn.close()
    print("  🎉 示例数据初始化完成！")


if __name__ == "__main__":
    print("[数据] 检查示例数据...")
    seed()
