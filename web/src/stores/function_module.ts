import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FunctionModule } from '../types'
import { getFunctionModules as fetchModules } from '../api/function_modules'

export const useFunctionModuleStore = defineStore('functionModule', () => {
  const modules = ref<FunctionModule[]>([])
  const loading = ref(false)

  async function loadModules() {
    loading.value = true
    try {
      const res = await fetchModules()
      modules.value = res.data.data || []
    } finally {
      loading.value = false
    }
  }

  return { modules, loading, loadModules }
})
