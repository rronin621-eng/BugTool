<template>
  <div class="task-manage">
    <div class="page-header">
      <h2>走查项目管理</h2>
      <el-button type="primary" @click="showDialog('create')">新建走查项目</el-button>
    </div>

    <el-table :data="taskStore.tasks" v-loading="taskStore.loading" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="项目名称" min-width="180" />
      <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column prop="status" label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '进行中' : '已结束' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="170">
        <template #default="{ row }">
          {{ formatDate(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160">
        <template #default="{ row }">
          <el-button link type="primary" @click="handleEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建走查项目' : '编辑走查项目'"
      width="480px"
    >
      <el-form :model="formData" label-width="90px">
        <el-form-item label="项目名称" required>
          <el-input v-model="formData.name" placeholder="请输入项目名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="formData.description"
            type="textarea"
            :rows="3"
            placeholder="请输入项目描述"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="formData.status" style="width: 100%">
            <el-option label="进行中" value="active" />
            <el-option label="已结束" value="ended" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useInspectionTaskStore } from '../stores/inspection_task'
import { createInspectionTask, updateInspectionTask, deleteInspectionTask } from '../api/inspection_tasks'
import type { InspectionTask } from '../types'

const taskStore = useInspectionTaskStore()
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const editingId = ref<number | null>(null)

const formData = ref({
  name: '',
  description: '',
  status: 'active',
})

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function showDialog(mode: 'create' | 'edit') {
  dialogMode.value = mode
  formData.value = { name: '', description: '', status: 'active' }
  editingId.value = null
  dialogVisible.value = true
}

function handleEdit(task: InspectionTask) {
  dialogMode.value = 'edit'
  editingId.value = task.id
  formData.value = { name: task.name, description: task.description || '', status: task.status }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formData.value.name) {
    ElMessage.warning('请填写项目名称')
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await createInspectionTask(formData.value)
      ElMessage.success('创建成功')
    } else if (editingId.value) {
      await updateInspectionTask(editingId.value, formData.value)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    taskStore.loadTasks()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(task: InspectionTask) {
  try {
    await ElMessageBox.confirm(`确定删除走查项目"${task.name}"？`, '确认', { type: 'warning' })
    await deleteInspectionTask(task.id)
    ElMessage.success('已删除')
    taskStore.loadTasks()
  } catch { /* cancelled */ }
}

onMounted(() => {
  taskStore.loadTasks()
})
</script>

<style scoped>
.task-manage {
  padding: 20px;
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
</style>
