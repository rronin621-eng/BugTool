<template>
  <div class="module-manage">
    <div class="page-header">
      <h2>功能模块管理</h2>
      <el-button type="primary" @click="showDialog('create')">新建功能模块</el-button>
    </div>

    <el-table :data="moduleStore.modules" v-loading="moduleStore.loading" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="模块名称" min-width="200" />
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
      :title="dialogMode === 'create' ? '新建功能模块' : '编辑功能模块'"
      width="400px"
    >
      <el-form :model="formData" label-width="90px">
        <el-form-item label="模块名称" required>
          <el-input v-model="formData.name" placeholder="请输入模块名称" />
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
import { useFunctionModuleStore } from '../stores/function_module'
import { createFunctionModule, updateFunctionModule, deleteFunctionModule } from '../api/function_modules'
import type { FunctionModule } from '../types'

const moduleStore = useFunctionModuleStore()
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const editingId = ref<number | null>(null)

const formData = ref({ name: '' })

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function showDialog(mode: 'create' | 'edit') {
  dialogMode.value = mode
  formData.value = { name: '' }
  editingId.value = null
  dialogVisible.value = true
}

function handleEdit(module: FunctionModule) {
  dialogMode.value = 'edit'
  editingId.value = module.id
  formData.value = { name: module.name }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formData.value.name) {
    ElMessage.warning('请填写模块名称')
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await createFunctionModule(formData.value)
      ElMessage.success('创建成功')
    } else if (editingId.value) {
      await updateFunctionModule(editingId.value, formData.value)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    moduleStore.loadModules()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(module: FunctionModule) {
  try {
    await ElMessageBox.confirm(`确定删除功能模块"${module.name}"？`, '确认', { type: 'warning' })
    await deleteFunctionModule(module.id)
    ElMessage.success('已删除')
    moduleStore.loadModules()
  } catch { /* cancelled */ }
}

onMounted(() => {
  moduleStore.loadModules()
})
</script>

<style scoped>
.module-manage {
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
