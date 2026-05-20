<template>
  <div class="bug-detail" v-loading="loading">
    <div class="page-header">
      <el-button @click="router.push('/bugs')">
        <el-icon><ArrowLeft /></el-icon> 返回列表
      </el-button>
      <h2>BUG #{{ bug?.id }}</h2>
    </div>

    <el-row :gutter="20" v-if="bug">
      <!-- 左侧：BUG信息 -->
      <el-col :span="16">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>{{ bug.title }}</span>
              <BugStatusTag :status="bug.status" />
            </div>
          </template>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="类型">
              {{ getLabel(BUG_TYPES, bug.bug_type) }}
            </el-descriptions-item>
            <el-descriptions-item label="优先级">
              <el-tag :type="getPriorityType(bug.priority)" size="small">
                {{ getLabel(BUG_PRIORITIES, bug.priority) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="录入人">
              {{ bug.reporter?.display_name || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="接收人">
              {{ bug.assignee?.display_name || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="走查项目">
              {{ getTaskName(bug.inspection_task_id) }}
            </el-descriptions-item>
            <el-descriptions-item label="功能模块">
              {{ getModuleName(bug.module_id) }}
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">
              {{ formatDate(bug.created_at) }}
            </el-descriptions-item>
            <el-descriptions-item label="更新时间">
              {{ formatDate(bug.updated_at) }}
            </el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">
              {{ bug.description || '暂无描述' }}
            </el-descriptions-item>
            <el-descriptions-item label="复现步骤" :span="2">
              <span style="white-space: pre-wrap;">{{ bug.reproduction_steps || '-' }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="环境链接" :span="2">
              <el-link v-if="bug.env_url" :href="bug.env_url" target="_blank" type="primary">
                {{ bug.env_url }}
              </el-link>
              <span v-else>-</span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 截图 -->
        <el-card shadow="never" style="margin-top: 16px" v-if="bug.screenshots?.length">
          <template #header>截图</template>
          <div class="screenshots">
            <el-image
              v-for="ss in bug.screenshots"
              :key="ss.id"
              :src="getScreenshotUrl(ss.file_path)"
              :preview-src-list="bug.screenshots.map(s => getScreenshotUrl(s.file_path))"
              fit="contain"
              style="width: 200px; height: 150px; margin-right: 12px; border: 1px solid #eee; border-radius: 4px;"
            />
          </div>
        </el-card>

        <!-- 状态流转 -->
        <el-card shadow="never" style="margin-top: 16px">
          <template #header>状态变更</template>
          <el-timeline>
            <el-timeline-item
              v-for="h in bug.history"
              :key="h.id"
              :timestamp="formatDate(h.created_at)"
              placement="top"
            >
              <p>
                <span v-if="h.from_status">{{ getLabel(BUG_STATUSES, h.from_status) }}</span>
                <span v-else>创建</span>
                → {{ getLabel(BUG_STATUSES, h.to_status) }}
              </p>
              <p v-if="h.comment" style="color: #999; font-size: 13px;">{{ h.comment }}</p>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>

      <!-- 右侧：操作面板 -->
      <el-col :span="8">
        <el-card shadow="never">
          <template #header>操作</template>
          <el-form label-position="top">
            <el-form-item label="变更状态">
              <el-select v-model="newStatus" style="width: 100%">
                <el-option v-for="s in BUG_STATUSES" :key="s.value" :label="s.label" :value="s.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="statusComment" type="textarea" :rows="2" />
            </el-form-item>
            <el-button type="primary" style="width: 100%" :loading="submitting" @click="handleStatusChange">
              更新状态
            </el-button>
          </el-form>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <template #header>修改信息</template>
          <el-button type="danger" style="width: 100%" @click="handleDelete">删除BUG</el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
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
    await ElMessageBox.confirm('确定要删除此BUG吗？', '确认删除', { type: 'warning' })
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
  padding: 20px;
}
.page-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.page-header h2 {
  margin: 0;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.screenshots {
  display: flex;
  flex-wrap: wrap;
}
</style>
