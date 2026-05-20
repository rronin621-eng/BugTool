<template>
  <span class="status-tag" :class="`status-${props.status}`">{{ statusLabel }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BUG_STATUSES } from '../types'

const props = defineProps<{ status: string }>()

const statusLabel = computed(() => {
  return BUG_STATUSES.find(s => s.value === props.status)?.label || props.status
})
</script>

<style scoped>
.status-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.status-new {
  background: #f0f0f0;
  color: #333;
}

.status-in_progress {
  background: #2b2b2b;
  color: #f0f0f0;
}

.status-fixed {
  background: #e8e8e8;
  color: #555;
}

.status-closed {
  background: #f8f8f8;
  color: #aaa;
}
</style>
