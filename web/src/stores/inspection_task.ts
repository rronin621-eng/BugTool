import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { InspectionTask } from '../types'
import { getInspectionTasks as fetchTasks } from '../api/inspection_tasks'

export const useInspectionTaskStore = defineStore('inspectionTask', () => {
  const tasks = ref<InspectionTask[]>([])
  const loading = ref(false)

  // 构建树形结构
  const taskTree = computed(() => {
    const map = new Map<number, InspectionTask>()
    const roots: InspectionTask[] = []

    // 先建立 id -> task 映射，并初始化 children
    tasks.value.forEach(t => {
      map.set(t.id, { ...t, children: [] })
    })

    // 构建父子关系
    map.forEach(t => {
      if (t.parent_id && map.has(t.parent_id)) {
        map.get(t.parent_id)!.children!.push(t)
      } else {
        roots.push(t)
      }
    })

    return roots
  })

  async function loadTasks(status?: string) {
    loading.value = true
    try {
      const res = await fetchTasks(status ? { status } : undefined)
      tasks.value = res.data.data || []
    } finally {
      loading.value = false
    }
  }

  return { tasks, taskTree, loading, loadTasks }
})
