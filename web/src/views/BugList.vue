<template>
  <div class="bug-list-layout">
    <!-- 左侧项目栏 -->
    <div class="project-sidebar">
      <div class="sidebar-header">
        <span class="sidebar-title">走查项目</span>
        <button class="icon-btn" @click="openProjectDialog()" title="新建项目">
          <el-icon><Plus /></el-icon>
        </button>
      </div>
      <ul class="project-list">
        <li
          class="project-item"
          :class="{ active: filters.inspection_task_id === undefined }"
          @click="selectProject(undefined)"
        >
          <el-icon class="project-icon"><Collection /></el-icon>
          <span class="project-name">全部项目</span>
        </li>
        <li
          v-for="t in taskStore.tasks"
          :key="t.id"
          class="project-item"
          :class="{ active: filters.inspection_task_id === t.id }"
          @click="selectProject(t.id)"
        >
          <el-icon class="project-icon"><FolderOpened /></el-icon>
          <span class="project-name">{{ t.name }}</span>
          <span class="project-actions" @click.stop>
            <button class="proj-action-btn" @click="openProjectDialog(t)" title="编辑">
              <el-icon><Edit /></el-icon>
            </button>
            <button class="proj-action-btn danger" @click="handleDeleteProject(t)" title="删除">
              <el-icon><Delete /></el-icon>
            </button>
          </span>
        </li>
      </ul>
    </div>

    <!-- 右侧主体 -->
    <div class="bug-main">
      <!-- 顶部标题栏 -->
      <div class="page-header">
        <div class="page-title-group">
          <h1 class="page-title">BUG 列表</h1>
          <span class="page-subtitle" v-if="bugStore.total > 0">共 {{ bugStore.total }} 条</span>
        </div>
        <el-button type="primary" class="create-btn" @click="showCreateDialog = true">
          <el-icon><Plus /></el-icon>
          新建 BUG
        </el-button>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <div class="filter-field">
          <label class="filter-label">功能模块</label>
          <el-select v-model="filters.module_id" clearable placeholder="全部" size="default">
            <el-option v-for="m in moduleStore.modules" :key="m.id" :label="m.name" :value="m.id" />
          </el-select>
        </div>
        <div class="filter-field search-field">
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="搜索标题 / 描述..."
            :prefix-icon="Search"
            @keyup.enter="handleSearch"
          />
        </div>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <!-- 表格 -->
      <div class="table-wrap">
        <el-table
          :data="bugStore.bugs"
          v-loading="bugStore.loading"
          row-class-name="table-row"
          :default-sort="{ prop: 'id', order: 'descending' }"
          style="width: 100%"
        >
          <el-table-column prop="id" label="ID" width="68" sortable>
            <template #default="{ row }">
              <span class="id-cell">#{{ row.id }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="title" label="标题" min-width="200">
            <template #default="{ row }">
              <span class="title-link" @click="router.push(`/bugs/${row.id}`)">{{ row.title }}</span>
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
              <span class="type-tag">{{ getLabel(BUG_TYPES, row.bug_type) }}</span>
            </template>
          </el-table-column>

          <el-table-column
            prop="status"
            label="状态"
            width="105"
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
            width="105"
            :filters="BUG_PRIORITIES.map(p => ({ text: p.label, value: p.value }))"
            :filter-method="(val: string, row: any) => row.priority === val"
            filter-placement="bottom"
            sortable
          >
            <template #default="{ row }">
              <span class="priority-dot" :class="`priority-${row.priority}`"></span>
              <span class="priority-text">{{ getLabel(BUG_PRIORITIES, row.priority) }}</span>
            </template>
          </el-table-column>

          <el-table-column prop="inspection_task_id" label="走查项目" width="140">
            <template #default="{ row }">
              <span class="meta-text">{{ getTaskName(row.inspection_task_id) }}</span>
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
              <span class="meta-text">{{ getModuleName(row.module_id) }}</span>
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
              <div class="avatar-cell">
                <div class="avatar-mini">{{ getAvatarChar(row.reporter_id) }}</div>
                <span>{{ getUserName(row.reporter_id) }}</span>
              </div>
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
              <div class="avatar-cell" v-if="row.assignee_id">
                <div class="avatar-mini assignee">{{ getAvatarChar(row.assignee_id) }}</div>
                <span>{{ getUserName(row.assignee_id) }}</span>
              </div>
              <span class="unassigned" v-else>未分配</span>
            </template>
          </el-table-column>

          <el-table-column prop="created_at" label="创建时间" width="155" sortable>
            <template #default="{ row }">
              <span class="date-text">{{ formatDate(row.created_at) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

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
    <el-dialog v-model="showCreateDialog" title="新建 BUG" width="600px" class="bug-dialog">
      <el-form :model="createForm" label-width="80px" class="bug-form">
        <!-- 基础信息 -->
        <div class="form-section">
          <div class="form-section-title">基础信息</div>
          <el-form-item label="标题" required>
            <el-input v-model="createForm.title" placeholder="请输入 BUG 标题" />
          </el-form-item>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="BUG 类型" required>
                <el-select v-model="createForm.bug_type" style="width: 100%">
                  <el-option v-for="t in BUG_TYPES" :key="t.value" :label="t.label" :value="t.value" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="优先级">
                <el-select v-model="createForm.priority" style="width: 100%">
                  <el-option v-for="p in BUG_PRIORITIES" :key="p.value" :label="p.label" :value="p.value" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <!-- 人员信息 -->
        <div class="form-section">
          <div class="form-section-title">人员信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="录入人" required>
                <el-select v-model="createForm.reporter_id" style="width: 100%">
                  <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="接收人">
                <el-select v-model="createForm.assignee_id" clearable style="width: 100%">
                  <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </div>

        <!-- 关联信息 -->
        <div class="form-section">
          <div class="form-section-title">关联信息</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="走查项目">
                <el-select v-model="createForm.inspection_task_id" clearable placeholder="不关联" style="width: 100%">
                  <el-option v-for="t in taskStore.tasks" :key="t.id" :label="t.name" :value="t.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="功能模块">
                <el-select v-model="createForm.module_id" clearable placeholder="不关联" style="width: 100%">
                  <el-option v-for="m in moduleStore.modules" :key="m.id" :label="m.name" :value="m.id" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="环境链接">
            <el-input v-model="createForm.env_url" placeholder="https://..." clearable />
          </el-form-item>
        </div>

        <!-- 详细描述 -->
        <div class="form-section">
          <div class="form-section-title">详细描述</div>
          <el-form-item label="描述">
            <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="BUG 描述（可选）" />
          </el-form-item>
          <el-form-item label="复现步骤">
            <el-input v-model="createForm.reproduction_steps" type="textarea" :rows="3" placeholder="1. 打开页面&#10;2. 点击按钮&#10;3. 观察现象..." />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showCreateDialog = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleCreate">提交 BUG</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 新建/编辑项目弹窗 -->
    <el-dialog v-model="showProjectDialog" :title="editingProject ? '编辑项目' : '新建项目'" width="500px" class="bug-dialog">
      <el-form :model="projectForm" label-width="100px">
        <el-form-item label="项目名称" required>
          <el-input v-model="projectForm.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="projectForm.description" type="textarea" :rows="2" placeholder="项目描述（可选）" />
        </el-form-item>
        <el-form-item label="默认负责人">
          <el-select v-model="projectForm.default_assignee_id" clearable placeholder="截图提交 bug 时的默认接收人" style="width: 100%">
            <el-option v-for="u in userStore.users" :key="u.id" :label="u.display_name" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认环境路径">
          <el-input v-model="projectForm.default_env_url" placeholder="https://..." clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="projectForm.status" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="showProjectDialog = false">取消</el-button>
          <el-button type="primary" :loading="projectSubmitting" @click="handleSaveProject">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Collection, FolderOpened, Search } from '@element-plus/icons-vue'
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
    await ElMessageBox.confirm(`确定要删除项目「${task.name}」吗？删除后相关 BUG 不会被删除。`, '确认删除', {
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

function getUserName(id: number) {
  return userStore.users.find(u => u.id === id)?.display_name || `用户${id}`
}

function getAvatarChar(id: number) {
  const name = userStore.users.find(u => u.id === id)?.display_name || '?'
  return name.charAt(0)
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
  return new Date(dateStr).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  height: 100vh;
}

/* ── 左侧项目栏 ── */
.project-sidebar {
  width: 190px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #eaecf0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 12px 10px 16px;
}

.sidebar-title {
  font-size: 11px;
  font-weight: 700;
  color: #9aa0ac;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}

.icon-btn {
  width: 24px;
  height: 24px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  padding: 0;
}

.icon-btn:hover {
  background: #f4f4f4;
  color: #111;
  border-color: #999;
}

.project-list {
  list-style: none;
  padding: 4px 8px 8px;
  flex: 1;
}

.project-item {
  padding: 7px 8px;
  border-radius: 7px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  margin-bottom: 1px;
  display: flex;
  align-items: center;
  gap: 7px;
}

.project-item:hover {
  background: #f8fafc;
  color: #334155;
}

.project-item.active {
  background: #f0f0f0;
  color: #111;
  font-weight: 600;
}

.project-item.active .project-icon {
  color: #111;
}

.project-icon {
  font-size: 14px;
  color: #94a3b8;
  flex-shrink: 0;
  transition: color 0.12s;
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
  gap: 2px;
  flex-shrink: 0;
}

.project-item:hover .project-actions,
.project-item.active .project-actions {
  display: flex;
}

.proj-action-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #94a3b8;
  transition: background 0.12s, color 0.12s;
  padding: 0;
}

.proj-action-btn:hover {
  background: #ebebeb;
  color: #111111;
}

.proj-action-btn.danger:hover {
  background: #fef2f2;
  color: #ef4444;
}

/* ── 右侧主体 ── */
.bug-main {
  flex: 1;
  min-width: 0;
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── 顶部标题栏 ── */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title-group {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: -0.3px;
}

.page-subtitle {
  font-size: 13px;
  color: #94a3b8;
}

.create-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}

/* ── 筛选栏 ── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #eaecf0;
  border-radius: 10px;
  padding: 12px 16px;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  font-weight: 500;
}

.search-field {
  flex: 1;
  min-width: 160px;
}

/* ── 表格 ── */
.table-wrap {
  background: #fff;
  border-radius: 10px;
  border: 1px solid #eaecf0;
  overflow: hidden;
}

.table-wrap :deep(.el-table) {
  border-radius: 10px;
}

.table-wrap :deep(.el-table th.el-table__cell) {
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  border-bottom: 1px solid #eaecf0;
}

.table-wrap :deep(.el-table td.el-table__cell) {
  border-bottom: 1px solid #f1f5f9;
}

.table-wrap :deep(.table-row:hover td.el-table__cell) {
  background: #fafafa !important;
}

/* ── 表格单元格 ── */
.id-cell {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.title-link {
  color: #334155;
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s;
}

.title-link:hover {
  color: #111;
  text-decoration: underline;
}

.type-tag {
  font-size: 12px;
  color: #64748b;
}

.priority-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
  flex-shrink: 0;
}

.priority-critical { background: #ef4444; box-shadow: 0 0 4px rgba(239,68,68,0.5); }
.priority-high     { background: #f97316; }
.priority-medium   { background: #eab308; }
.priority-low      { background: #22c55e; }

.priority-text {
  font-size: 12.5px;
  color: #475569;
}

.meta-text {
  font-size: 12.5px;
  color: #64748b;
}

.avatar-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.avatar-mini {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #333;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.avatar-mini.assignee {
  background: #666;
}

.unassigned {
  font-size: 12px;
  color: #cbd5e1;
}

.date-text {
  font-size: 12px;
  color: #94a3b8;
}

/* ── 分页 ── */
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 8px;
}

/* ── 弹窗 ── */
.bug-form {
  padding: 0 4px;
}

.form-section {
  margin-bottom: 20px;
}

.form-section:last-child {
  margin-bottom: 0;
}

.form-section-title {
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f1f5f9;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>

<style>
/* 全局覆盖弹窗样式 */
.bug-dialog .el-dialog__header {
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 16px;
  margin-right: 0;
}

.bug-dialog .el-dialog__title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}

.bug-dialog .el-dialog__footer {
  border-top: 1px solid #f1f5f9;
  padding-top: 16px;
}
</style>
