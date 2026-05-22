<template>
  <el-container style="min-height: 100vh;">
    <el-aside :width="collapsed ? '60px' : '210px'" class="sidebar" :class="{ collapsed }">
      <!-- Logo 区域 -->
      <div class="logo" :class="{ 'logo-collapsed': collapsed }">
        <div class="logo-icon">B</div>
        <span v-if="!collapsed" class="logo-text">BUG 管理系统</span>
      </div>

      <!-- 导航菜单 -->
      <el-menu
        :default-active="route.path"
        router
        :collapse="collapsed"
        :collapse-transition="false"
        class="nav-menu"
      >
        <el-menu-item index="/bugs" class="nav-item">
          <el-icon><Document /></el-icon>
          <template #title>BUG 列表</template>
        </el-menu-item>
        <el-menu-item index="/inspection-tasks" class="nav-item">
          <el-icon><Folder /></el-icon>
          <template #title>走查项目</template>
        </el-menu-item>
        <el-menu-item index="/function-modules" class="nav-item">
          <el-icon><Grid /></el-icon>
          <template #title>功能模块</template>
        </el-menu-item>
        <el-menu-item index="/users" class="nav-item">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
      </el-menu>

      <!-- 底部版本号 -->
      <div class="sidebar-footer" v-if="!collapsed">
        <span class="version-tag">v1.0</span>
      </div>

      <!-- 收起/展开按钮 -->
      <button class="collapse-btn" @click="collapsed = !collapsed" :title="collapsed ? '展开菜单' : '收起菜单'">
        <el-icon><ArrowLeft v-if="!collapsed" /><ArrowRight v-else /></el-icon>
      </button>
    </el-aside>

    <el-main class="main-content">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { Document, User, Folder, Grid, ArrowLeft, ArrowRight } from '@element-plus/icons-vue'

const route = useRoute()
const collapsed = ref(false)
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>

<style scoped>
.sidebar {
  background: #ffffff;
  display: flex;
  flex-direction: column;
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: visible !important;
  border-right: 1px solid #e8e8e8;
  z-index: 10;
}

/* ── Logo ── */
.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 18px;
  border-bottom: 1px solid #f0f0f0;
  overflow: hidden;
  white-space: nowrap;
  flex-shrink: 0;
}

.logo-collapsed {
  padding: 20px 0 18px;
  justify-content: center;
}

.logo-icon {
  width: 28px;
  height: 28px;
  background: #111;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.logo-text {
  font-size: 14px;
  font-weight: 600;
  color: #111;
  letter-spacing: 0.3px;
}

/* ── 导航菜单 ── */
.nav-menu {
  flex: 1;
  border-right: none !important;
  background: transparent !important;
  padding: 10px 8px;
}

.sidebar :deep(.el-menu--collapse) {
  width: 60px;
  padding: 10px 6px;
}

/* 菜单项样式覆盖 */
.sidebar :deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  border-radius: 8px;
  margin-bottom: 2px;
  color: #888 !important;
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.15s, color 0.15s;
  padding: 0 12px !important;
}

.sidebar :deep(.el-menu-item .el-icon) {
  color: #bbb;
  font-size: 16px;
  transition: color 0.15s;
}

.sidebar :deep(.el-menu-item:hover) {
  background: #f5f5f5 !important;
  color: #333 !important;
}

.sidebar :deep(.el-menu-item:hover .el-icon) {
  color: #555;
}

.sidebar :deep(.el-menu-item.is-active) {
  background: #111 !important;
  color: #fff !important;
}

.sidebar :deep(.el-menu-item.is-active .el-icon) {
  color: #fff;
}

/* collapse 模式居中 */
.sidebar :deep(.el-menu--collapse .el-menu-item) {
  padding: 0 !important;
  justify-content: center;
  width: 44px;
  margin-left: auto;
  margin-right: auto;
}

/* ── 底部版本号 ── */
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.version-tag {
  font-size: 11px;
  color: #ccc;
  letter-spacing: 0.5px;
}

/* ── 收起/展开按钮 ── */
.collapse-btn {
  position: absolute;
  right: -14px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #bbb;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10);
  transition: color 0.2s, box-shadow 0.2s, border-color 0.2s;
  padding: 0;
}

.collapse-btn:hover {
  color: #111;
  border-color: #111;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}

/* ── 主内容区 ── */
.main-content {
  background: #f7f7f7;
  padding: 0;
  overflow-y: auto;
  min-width: 0;
}
</style>
