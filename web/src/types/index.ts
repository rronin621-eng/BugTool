export interface User {
  id: number
  username: string
  display_name: string
  role: string
  created_at?: string
}

export interface InspectionTask {
  id: number
  name: string
  description?: string
  status: string
  default_assignee_id?: number | null
  default_env_url?: string | null
  created_at?: string
}

export interface FunctionModule {
  id: number
  name: string
  created_at?: string
}

export interface Bug {
  id: number
  title: string
  description?: string
  bug_type: string
  status: string
  priority: string
  reporter_id: number
  assignee_id?: number | null
  env_url?: string | null
  inspection_task_id?: number | null
  module_id?: number | null
  reproduction_steps?: string | null
  created_at?: string
  updated_at?: string
}

export interface BugDetail extends Bug {
  reporter?: User | null
  assignee?: User | null
  screenshots: Screenshot[]
  history: BugHistory[]
}

export interface Screenshot {
  id: number
  bug_id?: number | null
  file_path: string
  file_name: string
  file_size: number
  created_at?: string
}

export interface BugHistory {
  id: number
  bug_id: number
  from_status?: string | null
  to_status: string
  operator_id: number
  comment?: string | null
  created_at?: string
}

export interface ApiResponse<T = any> {
  code: number
  message: string
  data: T
}

export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export const BUG_TYPES = [
  { value: 'ui', label: 'UI缺陷' },
  { value: 'functional', label: '功能缺陷' },
  { value: 'performance', label: '性能问题' },
  { value: 'security', label: '安全问题' },
  { value: 'other', label: '其他' },
] as const

export const BUG_STATUSES = [
  { value: 'in_progress', label: '处理中', type: 'warning' },
  { value: 'fixed', label: '已修复', type: 'success' },
  { value: 'deferred', label: '暂不处理', type: 'info' },
  { value: 'closed', label: '已关闭', type: '' },
] as const

export const BUG_PRIORITIES = [
  { value: 'low', label: '低', type: 'info' },
  { value: 'medium', label: '中', type: 'warning' },
  { value: 'high', label: '高', type: 'danger' },
  { value: 'critical', label: '紧急', type: 'danger' },
] as const

export const INSPECTION_TASK_STATUSES = [
  { value: 'active', label: '进行中', type: 'success' },
  { value: 'ended', label: '已结束', type: 'info' },
] as const
