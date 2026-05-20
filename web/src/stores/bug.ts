import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Bug } from '../types'
import { getBugs as fetchBugs } from '../api/bugs'

export const useBugStore = defineStore('bug', () => {
  const bugs = ref<Bug[]>([])
  const total = ref(0)
  const loading = ref(false)

  async function loadBugs(params: {
    page?: number
    page_size?: number
    status?: string
    bug_type?: string
    keyword?: string
  } = {}) {
    loading.value = true
    try {
      const res = await fetchBugs(params)
      const data = res.data.data
      bugs.value = data?.items || []
      total.value = data?.total || 0
    } finally {
      loading.value = false
    }
  }

  return { bugs, total, loading, loadBugs }
})
