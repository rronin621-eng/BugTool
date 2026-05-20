<template>
  <div class="bug-list-layout">
    <!-- 左侧项目栏 -->
    <div class="project-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">走查项目</span>
        <el-button type="primary" link :icon="Plus" @click="openProjectDialog()" title="新建项目" />
      </div>
      <ul class="project-list">
        <li
          class="project-item"
          :class="{ active: filters.inspection_task_id === undefined }"
          @click="selectProject(undefined)"
        >全部项目</li>
        <li
          v-for="t in taskStore.tasks"
          :key="t.id"
          class="project-item"
          :class="{ active: filters.inspection_task_id === t.id }"
          @click="selectProject(t.id)"
        >
          <span class="project-name">{{ t.name }}</span>
          <span class="project-actions" @click.stop>
            <el-button type="primary" link :icon="Edit" size="small" @click="openProjectDialog(t)" />
            <el-button type="danger" link :icon="Delete" size="small" @click="handleDeleteProject(t)" />
          </span>
        </li>
      </ul>
    </div>

    <!-- 右侧主体 -->
    <div class="bug-main">
      <div class="page-header">
        <h2>BUG列表</h2>
        <el-button type="primary" @click="showCreateDialog = true">新建BUG</el-button>
      </div>

      <!-- 筛选栏 -->
      <el-card class="filter-card" shadow="never">
        <el-form :inline="true" :model="filters" @submit.prevent="handleSearch">
          <el-form-item label="功能模块">
            <el-select v-model="filters.module_id" clearable placeholder="全部" style="width: 140px">
              <el-option v-for="m in moduleStore.modules" :key="m.id" :label="m.name" :value="m.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="搜索">
            <el-input v-model="filters.keyword" clearable placeholder="标题/描述" style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">搜索</el-button>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 表格 -->
      <el-table
        :data="bugStore.bugs"
        v-loading="bugStore.loading"
        stripe
        style="width: 100%"
        :default-sort="{ prop: 'id', order: 'descending' }"
      >
        <el-table-column prop="id" label="ID" width="70" sortable />
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/bugs/${row.id}`)">{{ row.title }}</el-link>
          </template>
        </el-table-column>

        <el-table-column
          prop="bug_type"
          label="类型"
          width="110"
          :filters="BUG_TYPES.map(t => ({ text: t.label, value: t.value }))"
          :filter-method="(val: string, row: any) => row.bug_type === val"
          filter-placement="bottom"
        >
          <template #default="{ row }">
            {{ getLabel(BUG_TYPES, row.bug_type) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="status"
          label="状态"
          width="110"
          :filters="BUG_STATUSES.map(s => ({ text: s.label, value: s.value }))"
          :filter-method="(val: string, row: any) => row.status === val"
          filter-placement="bottom"
        >
          <template #default="{ row }">
            <BugStatusTag :status="row.status" />
          </template>
        </el-table-column>

        <el-table-column
          prop="priority"
          label="优先级"
          width="110"
          :filters="BUG_PRIORITIES.map(p => ({ text: p.label, value: p.value }))"
          :filter-method="(val: string, row: any) => row.priority === val"
          filter-placement="bottom"
          sortable
        >
          <template #default="{ row }">
            <el-tag :type="getPriorityType(row.priority)" size="small">
              {{ getLabel(BUG_PRIORITIES, row.priority) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="inspection_task_id" label="走查项目" width="140">
          <template #default="{ row }">
            {{ getTaskName(row.inspection_task_id) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="module_id"
          label="功能模块"
          width="120"
          :filters="moduleStore.modules.map(m => ({ text: m.name, value: m.id }))"
          :filter-method="(val: number, row: any) => row.module_id === val"
          filter-placement="bottom"
        >
          <template #default="{ row }">
            {{ getModuleName(row.module_id) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="reporter_id"
          label="录入人"
          width="110"
          :filters="userStore.users.map(u => ({ text: u.display_name, value: u.id }))"
          :filter-method="(val: number, row: any) => row.reporter_id === val"
          filter-placement="bottom"
        >
          <template #default="{ row }">
            {{ getUserName(row.reporter_id) }}
          </template>
        </el-table-column>

        <el-table-column
          prop="assignee_id"
          label="接收人"
          width="110"
          :filters="[{ text: '未分配', value: 0 }, ...userStore.users.map(u => ({ text: u.display_name, value: u.id }))]"
          :filter-method="(val: number, row: any) => val === 0 ? !row.assignee_id : row.assignee_id === val"
          filter-placement="bottom"
        >
          <template #default="{ row }">
            {{ row.assignee_id ? getUserName(row.assignee_id) : '未分配' }}
          </template>
        </el-table-column>

        <el-table-column prop="created_at" label="创建时间" width="170" sortable>
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="bugStore.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadData"
          @size-change="loadData"
        />
      </div>
    </div>

    <!-- 新建BUG弹窗 -->
    <el-dialog v-model="showCreateDialog" title="新建BUG" width="560px">
      <el-form :model="createForm" label-width="90px">
        <el-form-item label="标题" required>
          <el-input v-model="createForm.title" placeholder="BUG标题" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-select v-model="createForm.bug_type" style="width: 100%">
            <el-option v-for="t in BUG_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="createForm.priority" style="width: 100%">
            <el-option v-for="p in BUG_PRIORITIES" :key="p.value" :label="p.label" :value="p.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="录入人" required>
          <el-select v-model="createForm.reporter_id" style="width: 100%">
            <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="接收人">
          <el-select v-model="createForm.assignee_id" clearable style="width: 100%">
            <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="走查项目">
          <el-select v-model="createForm.inspection_task_id" clearable placeholder="不关联" style="width: 100%">
            <el-option v-for="t in taskStore.tasks" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="功能模块">
          <el-select v-model="createForm.module_id" clearable placeholder="不关联" style="width: 100%">
            <el-option v-for="m in moduleStore.modules" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="复现步骤">
          <el-input v-model="createForm.reproduction_steps" type="textarea" :rows="3" placeholder="请描述复现步骤..." />
        </el-form-item>
        <el-form-item label="环境链接">
          <el-input v-model="createForm.env_url" placeholder="http://..." clearable />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate">提交</el-button>
      </template>
    </el-dialog>

    <!-- 新建/编辑项目弹窗 -->
    <el-dialog v-model="showProjectDialog" :title="editingProject ? '编辑项目' : '新建项目'" width="480px">
      <el-form :model="projectForm" label-width="100px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectForm.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="projectForm.description" type="textarea" :rows="2" placeholder="项目描述（可选）" />
        </el-form-item>
        <el-form-item label="默认负责人">
          <el-select v-model="projectForm.default_assignee_id" clearable placeholder="截图提交bug时的默认接收人" style="width: 100%">
            <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认环境路径">
          <el-input v-model="projectForm.default_env_url" placeholder="http://..." clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="projectForm.status" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showProjectDialog = false">取消</el-button>
        <el-button type="primary" :loading="projectSubmitting" @click="handleSaveProject">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete } from '@element-plus/icons-vue'
import { useBugStore } from '../stores/bug'
import { useUserStore } from '../stores/user'
import { useInspectionTaskStore } from '../stores/inspection_task'
import { useFunctionModuleStore } from '../stores/function_module'
import { createBug } from '../api/bugs'
import { createInspectionTask, updateInspectionTask, deleteInspectionTask } from '../api/inspection_tasks'
import { BUG_TYPES, BUG_STATUSES, BUG_PRIORITIES } from '../types'
import type { InspectionTask } from '../types'
import BugStatusTag from '../components/BugStatusTag.vue'

const router = useRouter()
const bugStore = useBugStore()
const userStore = useUserStore()
const taskStore = useInspectionTaskStore()
const moduleStore = useFunctionModuleStore()

const page = ref(1)
const pageSize = ref(20)
const showCreateDialog = ref(false)
const submitting = ref(false)

// 项目弹窗
const showProjectDialog = ref(false)
const projectSubmitting = ref(false)
const editingProject = ref<InspectionTask | null>(null)
const projectForm = ref({
  name: '',
  description: '',
  status: 'active',
  default_assignee_id: undefined as number | undefined,
  default_env_url: '',
})

function openProjectDialog(task?: InspectionTask) {
  editingProject.value = task || null
  if (task) {
    projectForm.value = {
      name: task.name,
      description: task.description || '',
      status: task.status,
      default_assignee_id: task.default_assignee_id ?? undefined,
      default_env_url: task.default_env_url || '',
    }
  } else {
    projectForm.value = { name: '', description: '', status: 'active', default_assignee_id: undefined, default_env_url: '' }
  }
  showProjectDialog.value = true
}

async function handleSaveProject() {
  if (!projectForm.value.name.trim()) {
    ElMessage.warning('请输入项目名称')
    return
  }
  projectSubmitting.value = true
  try {
    if (editingProject.value) {
      await updateInspectionTask(editingProject.value.id, projectForm.value)
      ElMessage.success('项目已更新')
    } else {
      await createInspectionTask(projectForm.value)
      ElMessage.success('项目已创建')
    }
    showProjectDialog.value = false
    await taskStore.loadTasks()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    projectSubmitting.value = false
  }
}

async function handleDeleteProject(task: InspectionTask) {
  try {
    await ElMessageBox.confirm(`确定要删除项目「${task.name}」吗？删除后相关BUG不会被删除。`, '确认删除', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
  } catch {
    return
  }
  try {
    await deleteInspectionTask(task.id)
    ElMessage.success('项目已删除')
    if (filters.value.inspection_task_id === task.id) {
      selectProject(undefined)
    }
    await taskStore.loadTasks()
  } catch (e: any) {
    ElMessage.error(e.message || '删除失败')
  }
}

const filters = ref({
  keyword: '',
  inspection_task_id: undefined as number | undefined,
  module_id: undefined as number | undefined,
})

const createForm = ref({
  title: '',
  bug_type: 'ui',
  priority: 'medium',
  reporter_id: undefined as number | undefined,
  assignee_id: undefined as number | undefined,
  description: '',
  env_url: '',
  inspection_task_id: undefined as number | undefined,
  module_id: undefined as number | undefined,
  reproduction_steps: '',
})

function getLabel(list: ReadonlyArray<{ value: string; label: string }>, val: string) {
  return list.find(i => i.value === val)?.label || val
}

function getPriorityType(priority: string) {
  return BUG_PRIORITIES.find(i => i.value === priority)?.type || 'info'
}

function getUserName(id: number) {
  return userStore.users.find(u => u.id === id)?.display_name || `用户${id}`
}

function getTaskName(id?: number | null) {
  if (!id) return '-'
  return taskStore.tasks.find(t => t.id === id)?.name || `项目${id}`
}

function getModuleName(id?: number | null) {
  if (!id) return '-'
  return moduleStore.modules.find(m => m.id === id)?.name || `模块${id}`
}

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function selectProject(taskId: number | undefined) {
  filters.value.inspection_task_id = taskId
  page.value = 1
  loadData()
}

function handleSearch() {
  page.value = 1
  loadData()
}

function handleReset() {
  filters.value = { keyword: '', inspection_task_id: undefined, module_id: undefined }
  page.value = 1
  loadData()
}

function loadData() {
  bugStore.loadBugs({
    page: page.value,
    page_size: pageSize.value,
    ...filters.value,
  })
}

async function handleCreate() {
  if (!createForm.value.title || !createForm.value.reporter_id) {
    ElMessage.warning('请填写必填字段')
    return
  }
  submitting.value = true
  try {
    await createBug(createForm.value)
    ElMessage.success('创建成功')
    showCreateDialog.value = false
    createForm.value = {
      title: '', bug_type: 'ui', priority: 'medium',
      reporter_id: undefined, assignee_id: undefined,
      description: '', env_url: '',
      inspection_task_id: undefined, module_id: undefined, reproduction_steps: '',
    }
    loadData()
  } catch (e: any) {
    ElMessage.error(e.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  userStore.loadUsers()
  taskStore.loadTasks()
  moduleStore.loadModules()
  loadData()
})
</script>

<style scoped>
.bug-list-layout {
  display: flex;
  height: 100%;
  min-height: 100vh;
}

/* ── 左侧项目栏 ── */
.project-sidebar {
  width: 180px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 10px 8px 16px;
}

.sidebar-title {
  font-size: 12px;
  font-weight: 600;
  color: #909399;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.project-list {
  list-style: none;
  padding: 0 8px;
  flex: 1;
}

.project-item {
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: #606266;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.project-item:hover {
  background: #f0f2f5;
  color: #303133;
}

.project-item.active {
  background: #ecf5ff;
  color: #409eff;
  font-weight: 500;
}

.project-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.project-actions {
  display: none;
  align-items: center;
  gap: 0px;
  flex-shrink: 0;
}

.project-item:hover .project-actions {
  display: flex;
}

.project-item.active .project-actions {
  display: flex;
}

/* ── 右侧主体 ── */
.bug-main {
  flex: 1;
  min-width: 0;
  padding: 20px;
  overflow-y: auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.page-header h2 {
  margin: 0;
}

.filter-card {
  margin-bottom: 16px;
}

.pagination-wrap {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
