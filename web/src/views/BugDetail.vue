<template>
  <div class="bug-detail" v-loading="loading">
    <!-- 顶部导航栏 -->
    <div class="detail-header">
      <button class="back-btn" @click="router.push('/bugs')">
        <el-icon><ArrowLeft /></el-icon>
        <span>返回列表</span>
      </button>
      <div class="header-meta" v-if="bug">
        <span class="bug-id">#{{ bug.id }}</span>
        <BugStatusTag :status="bug.status" />
      </div>
    </div>

    <div v-if="bug" class="detail-body">
      <!-- 主标题 -->
      <h1 class="bug-title">{{ bug.title }}</h1>

      <div class="detail-grid">
        <!-- 左列：内容 -->
        <div class="detail-main">

          <!-- 基础信息卡片 -->
          <div class="info-card">
            <div class="card-title">基础信息</div>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">BUG 类型</span>
                <span class="info-value">{{ getLabel(BUG_TYPES, bug.bug_type) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">优先级</span>
                <div class="info-value priority-row">
                  <span class="priority-dot" :class="`p-${bug.priority}`"></span>
                  <el-tag :type="getPriorityType(bug.priority)" size="small" effect="light">
                    {{ getLabel(BUG_PRIORITIES, bug.priority) }}
                  </el-tag>
                </div>
              </div>
              <div class="info-item">
                <span class="info-label">录入人</span>
                <div class="info-value user-row">
                  <div class="avatar" v-if="bug.reporter">{{ bug.reporter.display_name.charAt(0) }}</div>
                  <span>{{ bug.reporter?.display_name || '-' }}</span>
                </div>
              </div>
              <div class="info-item">
                <span class="info-label">接收人</span>
                <div class="info-value user-row">
                  <div class="avatar assignee" v-if="bug.assignee">{{ bug.assignee.display_name.charAt(0) }}</div>
                  <span>{{ bug.assignee?.display_name || '未分配' }}</span>
                </div>
              </div>
              <div class="info-item">
                <span class="info-label">走查项目</span>
                <span class="info-value">{{ getTaskName(bug.inspection_task_id) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">功能模块</span>
                <span class="info-value">{{ getModuleName(bug.module_id) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">创建时间</span>
                <span class="info-value">{{ formatDate(bug.created_at) }}</span>
              </div>
              <div class="info-item">
                <span class="info-label">更新时间</span>
                <span class="info-value">{{ formatDate(bug.updated_at) }}</span>
              </div>
              <div class="info-item full-width" v-if="bug.env_url">
                <span class="info-label">环境链接</span>
                <el-link :href="bug.env_url" target="_blank" type="primary" class="info-value link-value">
                  {{ bug.env_url }}
                </el-link>
              </div>
            </div>
          </div>

          <!-- 描述 -->
          <div class="info-card" v-if="bug.description">
            <div class="card-title">BUG 描述</div>
            <p class="content-text">{{ bug.description }}</p>
          </div>

          <!-- 复现步骤 -->
          <div class="info-card" v-if="bug.reproduction_steps">
            <div class="card-title">复现步骤</div>
            <pre class="steps-text">{{ bug.reproduction_steps }}</pre>
          </div>

          <!-- 截图 -->
          <div class="info-card" v-if="bug.screenshots?.length">
            <div class="card-title">截图 <span class="count-badge">{{ bug.screenshots.length }}</span></div>
            <div class="screenshots">
              <el-image
                v-for="ss in bug.screenshots"
                :key="ss.id"
                :src="getScreenshotUrl(ss.file_path)"
                :preview-src-list="bug.screenshots.map(s => getScreenshotUrl(s.file_path))"
                fit="cover"
                class="screenshot-thumb"
              />
            </div>
          </div>

          <!-- 状态历史 -->
          <div class="info-card" v-if="bug.history?.length">
            <div class="card-title">状态历史</div>
            <div class="timeline">
              <div class="timeline-item" v-for="h in bug.history" :key="h.id">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-main">
                    <span class="timeline-status">
                      <span v-if="h.from_status" class="from-status">{{ getLabel(BUG_STATUSES, h.from_status) }}</span>
                      <span v-else class="from-status">创建</span>
                      <el-icon class="arrow-icon"><ArrowRight /></el-icon>
                      <span class="to-status">{{ getLabel(BUG_STATUSES, h.to_status) }}</span>
                    </span>
                    <span class="timeline-time">{{ formatDate(h.created_at) }}</span>
                  </div>
                  <p v-if="h.comment" class="timeline-comment">{{ h.comment }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 右列：操作 -->
        <div class="detail-side">
          <!-- 状态变更 -->
          <div class="action-card">
            <div class="card-title">更新状态</div>
            <el-form label-position="top">
              <el-form-item label="变更为">
                <el-select v-model="newStatus" style="width: 100%">
                  <el-option v-for="s in BUG_STATUSES" :key="s.value" :label="s.label" :value="s.value" />
                </el-select>
              </el-form-item>
              <el-form-item :label="newStatus === 'deferred' ? '暂不处理理由（必填）' : '备注（可选）'">
                <el-input v-model="statusComment" type="textarea" :rows="3"
                  :placeholder="newStatus === 'deferred' ? '请说明暂不处理的原因...' : '说明变更原因...'" />
              </el-form-item>
              <el-button type="primary" style="width: 100%" :loading="submitting" @click="handleStatusChange">
                确认更新
              </el-button>
            </el-form>
          </div>

          <!-- 危险操作 -->
          <div class="action-card danger-card">
            <div class="card-title">危险操作</div>
            <el-button type="danger" plain style="width: 100%" @click="handleDelete">
              <el-icon><Delete /></el-icon>
              删除此 BUG
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-if="!bug && !loading" class="empty-state">
      <div class="empty-icon">🐛</div>
      <p>未找到该 BUG</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, ArrowRight, Delete } from '@element-plus/icons-vue'
import { getBug, updateBugStatus, deleteBug } from '../api/bugs'
import { useUserStore } from '../stores/user'
import { useInspectionTaskStore } from '../stores/inspection_task'
import { useFunctionModuleStore } from '../stores/function_module'
import { BUG_TYPES, BUG_STATUSES, BUG_PRIORITIES } from '../types'
import type { BugDetail } from '../types'
import BugStatusTag from '../components/BugStatusTag.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const taskStore = useInspectionTaskStore()
const moduleStore = useFunctionModuleStore()

const bug = ref<BugDetail | null>(null)
const loading = ref(false)
const submitting = ref(false)
const newStatus = ref('')
const statusComment = ref('')

function getLabel(list: ReadonlyArray<{ value: string; label: string }>, val: string) {
  return list.find(i => i.value === val)?.label || val
}

function getPriorityType(priority: string) {
  return BUG_PRIORITIES.find(i => i.value === priority)?.type || 'info'
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function getScreenshotUrl(path: string) {
  return path
}

function getTaskName(id?: number | null) {
  if (!id) return '-'
  return taskStore.tasks.find(t => t.id === id)?.name || `项目${id}`
}

function getModuleName(id?: number | null) {
  if (!id) return '-'
  return moduleStore.modules.find(m => m.id === id)?.name || `模块${id}`
}

async function loadBug() {
  loading.value = true
  try {
    const id = Number(route.params.id)
    const res = await getBug(id)
    bug.value = res.data.data
    if (bug.value) {
      newStatus.value = bug.value.status
    }
  } finally {
    loading.value = false
  }
}

async function handleStatusChange() {
  if (!bug.value || !newStatus.value) return
  if (newStatus.value === 'deferred' && !statusComment.value.trim()) {
    ElMessage.warning('变更为「暂不处理」时，理由为必填项')
    return
  }
  submitting.value = true
  try {
    await updateBugStatus(bug.value.id, {
      status: newStatus.value,
      comment: statusComment.value,
    })
    ElMessage.success('状态已更新')
    statusComment.value = ''
    loadBug()
  } catch (e: any) {
    ElMessage.error(e.message || '更新失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  if (!bug.value) return
  try {
    await ElMessageBox.confirm('确定要删除此 BUG 吗？此操作不可撤销。', '确认删除', { type: 'warning' })
    await deleteBug(bug.value.id)
    ElMessage.success('已删除')
    router.push('/bugs')
  } catch { /* cancelled */ }
}

onMounted(() => {
  userStore.loadUsers()
  taskStore.loadTasks()
  moduleStore.loadModules()
  loadBug()
})
</script>

<style scoped>
.bug-detail {
  padding: 0;
  min-height: 100vh;
  background: #f4f6fb;
}

/* ── 顶部导航 ── */
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 28px;
  background: #fff;
  border-bottom: 1px solid #eaecf0;
  position: sticky;
  top: 0;
  z-index: 10;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.back-btn:hover {
  background: #f4f4f4;
  color: #111;
  border-color: #111;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bug-id {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* ── 主体 ── */
.detail-body {
  padding: 28px;
  max-width: 1200px;
}

.bug-title {
  font-size: 22px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: -0.4px;
  line-height: 1.4;
  margin-bottom: 24px;
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 20px;
  align-items: start;
}

.detail-main {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: sticky;
  top: 72px;
}

/* ── 卡片通用 ── */
.info-card,
.action-card {
  background: #fff;
  border: 1px solid #eaecf0;
  border-radius: 12px;
  padding: 20px;
}

.card-title {
  font-size: 12px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-badge {
  background: #f1f5f9;
  color: #64748b;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0;
}

/* ── 信息网格 ── */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 24px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.info-value {
  font-size: 13.5px;
  color: #334155;
  font-weight: 500;
}

.link-value {
  font-size: 13px;
  word-break: break-all;
}

.priority-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.priority-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.p-critical { background: #ef4444; }
.p-high     { background: #f97316; }
.p-medium   { background: #eab308; }
.p-low      { background: #22c55e; }

.user-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #333;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar.assignee {
  background: #666;
}

/* ── 内容文本 ── */
.content-text {
  font-size: 14px;
  color: #475569;
  line-height: 1.7;
}

.steps-text {
  font-size: 13px;
  color: #475569;
  line-height: 1.7;
  white-space: pre-wrap;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 12px;
  font-family: inherit;
}

/* ── 截图 ── */
.screenshots {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.screenshot-thumb {
  width: 160px;
  height: 120px;
  border-radius: 8px;
  border: 1px solid #eaecf0;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  overflow: hidden;
}

.screenshot-thumb:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
}

/* ── 时间线 ── */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.timeline-item {
  display: flex;
  gap: 12px;
  position: relative;
  padding-bottom: 16px;
}

.timeline-item:last-child {
  padding-bottom: 0;
}

.timeline-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 5px;
  top: 14px;
  bottom: 0;
  width: 1px;
  background: #e2e8f0;
}

.timeline-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #222;
  border: 2px solid #fff;
  box-shadow: 0 0 0 2px #e0e0e0;
  flex-shrink: 0;
  margin-top: 3px;
}

.timeline-content {
  flex: 1;
  min-width: 0;
}

.timeline-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.timeline-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
}

.from-status {
  color: #94a3b8;
}

.arrow-icon {
  font-size: 11px;
  color: #cbd5e1;
}

.to-status {
  color: #334155;
  font-weight: 600;
}

.timeline-time {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}

.timeline-comment {
  margin-top: 4px;
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

/* ── 操作卡片 ── */
.danger-card {
  border-color: #fee2e2;
}

.danger-card .card-title {
  color: #fca5a5;
}

/* ── 空态 ── */
.empty-state {
  text-align: center;
  padding: 80px;
  color: #94a3b8;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
</style>
