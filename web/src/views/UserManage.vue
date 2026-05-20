<template>
  <div class="user-manage">
    <div class="page-header">
      <h2>用户管理</h2>
      <el-button type="primary" @click="showDialog('create')">新建用户</el-button>
    </div>

    <el-table :data="userStore.users" v-loading="userStore.loading" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="username" label="用户名" width="150" />
      <el-table-column prop="display_name" label="显示名称" width="150" />
      <el-table-column prop="role" label="角色" width="120">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'danger' : row.role === 'developer' ? 'warning' : 'info'" size="small">
            {{ roleMap[row.role] || row.role }}
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

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新建用户' : '编辑用户'" width="420px">
      <el-form :model="formData" label-width="80px">
        <el-form-item label="用户名" required>
          <el-input v-model="formData.username" :disabled="dialogMode === 'edit'" />
        </el-form-item>
        <el-form-item label="显示名称" required>
          <el-input v-model="formData.display_name" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="formData.role" style="width: 100%">
            <el-option label="测试人员" value="tester" />
            <el-option label="开发人员" value="developer" />
            <el-option label="管理员" value="admin" />
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
import { useUserStore } from '../stores/user'
import { createUser, updateUser, deleteUser } from '../api/users'
import type { User } from '../types'

const userStore = useUserStore()
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const editingId = ref<number | null>(null)

const roleMap: Record<string, string> = { tester: '测试人员', developer: '开发人员', admin: '管理员' }

const formData = ref({
  username: '',
  display_name: '',
  role: 'tester',
})

function formatDate(dateStr?: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function showDialog(mode: 'create' | 'edit') {
  dialogMode.value = mode
  formData.value = { username: '', display_name: '', role: 'tester' }
  editingId.value = null
  dialogVisible.value = true
}

function handleEdit(user: User) {
  dialogMode.value = 'edit'
  editingId.value = user.id
  formData.value = { username: user.username, display_name: user.display_name, role: user.role }
  dialogVisible.value = true
}

async function handleSubmit() {
  if (!formData.value.username || !formData.value.display_name) {
    ElMessage.warning('请填写必填字段')
    return
  }
  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await createUser(formData.value)
      ElMessage.success('创建成功')
    } else if (editingId.value) {
      await updateUser(editingId.value, formData.value)
      ElMessage.success('更新成功')
    }
    dialogVisible.value = false
    userStore.loadUsers()
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(user: User) {
  try {
    await ElMessageBox.confirm(`确定删除用户"${user.display_name}"？`, '确认', { type: 'warning' })
    await deleteUser(user.id)
    ElMessage.success('已删除')
    userStore.loadUsers()
  } catch { /* cancelled */ }
}

onMounted(() => {
  userStore.loadUsers()
})
</script>

<style scoped>
.user-manage {
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
