import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { User } from '../types'
import { getUsers as fetchUsers } from '../api/users'

export const useUserStore = defineStore('user', () => {
  const users = ref<User[]>([])
  const loading = ref(false)

  async function loadUsers() {
    loading.value = true
    try {
      const res = await fetchUsers()
      users.value = res.data.data || []
    } finally {
      loading.value = false
    }
  }

  return { users, loading, loadUsers }
})
