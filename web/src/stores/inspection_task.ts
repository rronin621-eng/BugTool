import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { InspectionTask } from '../types'
import { getInspectionTasks as fetchTasks } from '../api/inspection_tasks'

export const useInspectionTaskStore = defineStore('inspectionTask', () => {
  const tasks = ref<InspectionTask[]>([])
  const loading = ref(false)

  async function loadTasks(status?: string) {
    loading.value = true
    try {
      const res = await fetchTasks(status ? { status } : undefined)
      tasks.value = res.data.data || []
    } finally {
      loading.value = false
    }
  }

  return { tasks, loading, loadTasks }
})
