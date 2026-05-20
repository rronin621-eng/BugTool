import http from './index'
import type { Bug, BugDetail, ApiResponse, PaginatedData } from '../types'

export const getBugs = (params: {
  page?: number
  page_size?: number
  status?: string
  bug_type?: string
  priority?: string
  reporter_id?: number
  assignee_id?: number
  keyword?: string
}) => http.get<ApiResponse<PaginatedData<Bug>>>('/bugs', { params })

export const getBug = (id: number) =>
  http.get<ApiResponse<BugDetail>>(`/bugs/${id}`)

export const createBug = (data: Partial<Bug>) =>
  http.post<ApiResponse<Bug>>('/bugs', data)

export const updateBug = (id: number, data: Partial<Bug>) =>
  http.put<ApiResponse<Bug>>(`/bugs/${id}`, data)

export const updateBugStatus = (id: number, data: { status: string; comment?: string }) =>
  http.put<ApiResponse<Bug>>(`/bugs/${id}/status`, data)

export const deleteBug = (id: number) =>
  http.delete<ApiResponse>(`/bugs/${id}`)

export const uploadScreenshot = (file: File, bugId?: number) => {
  const formData = new FormData()
  formData.append('file', file)
  if (bugId) formData.append('bug_id', String(bugId))
  return http.post<ApiResponse>('/uploads/screenshot', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
