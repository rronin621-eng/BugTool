<template>
  <el-container style="min-height: 100vh;">
    <el-aside :width="collapsed ? '64px' : '200px'" class="sidebar" :class="{ collapsed }">
      <!-- Logo 区域 -->
      <div class="logo" :class="{ 'logo-collapsed': collapsed }">
        <span v-if="!collapsed">BUG管理系统</span>
        <span v-else>B</span>
      </div>

      <!-- 导航菜单 -->
      <el-menu
        :default-active="route.path"
        router
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409eff"
        :collapse="collapsed"
        :collapse-transition="false"
      >
        <el-menu-item index="/bugs">
          <el-icon><Document /></el-icon>
          <template #title>BUG列表</template>
        </el-menu-item>
        <el-menu-item index="/inspection-tasks">
          <el-icon><Folder /></el-icon>
          <template #title>走查项目</template>
        </el-menu-item>
        <el-menu-item index="/function-modules">
          <el-icon><Grid /></el-icon>
          <template #title>功能模块</template>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon>
          <template #title>用户管理</template>
        </el-menu-item>
      </el-menu>

      <!-- 收起/展开按钮 -->
      <button class="collapse-btn" @click="collapsed = !collapsed" :title="collapsed ? '展开菜单' : '收起菜单'">
        <el-icon><ArrowLeft v-if="!collapsed" /><ArrowRight v-else /></el-icon>
      </button>
    </el-aside>

    <el-main style="background: #f0f2f5; padding: 0;">
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>

<style scoped>
.sidebar {
  background: #304156;
  display: flex;
  flex-direction: column;
  transition: width 0.25s ease;
  position: relative;
  overflow: visible !important;
}

.sidebar :deep(.el-menu) {
  border-right: none;
  flex: 1;
}

.sidebar :deep(.el-menu--collapse) {
  width: 64px;
}

.logo {
  color: #fff;
  text-align: center;
  padding: 16px 0;
  font-size: 16px;
  font-weight: bold;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  white-space: nowrap;
  overflow: hidden;
  transition: padding 0.25s;
  flex-shrink: 0;
}

.logo-collapsed {
  font-size: 18px;
  padding: 16px 0;
}

/* 收起/展开按钮 */
.collapse-btn {
  position: absolute;
  right: -13px;
  top: 50%;
  transform: translateY(-50%);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid #dcdfe6;
  background: #fff;
  color: #909399;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  transition: color 0.2s, box-shadow 0.2s;
  padding: 0;
}

.collapse-btn:hover {
  color: #409eff;
  box-shadow: 0 2px 12px rgba(64,158,255,0.3);
}
</style>
