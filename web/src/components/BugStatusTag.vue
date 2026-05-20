<template>
  <el-tag :type="statusType" size="small">{{ statusLabel }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BUG_STATUSES } from '../types'

const props = defineProps<{ status: string }>()

const statusLabel = computed(() => {
  return BUG_STATUSES.find(s => s.value === props.status)?.label || props.status
})

const statusType = computed(() => {
  return BUG_STATUSES.find(s => s.value === props.status)?.type || 'info'
})
</script>
