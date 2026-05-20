import http from './index'
import type { InspectionTask, ApiResponse } from '../types'

export const getInspectionTasks = (params?: { status?: string }) =>
  http.get<ApiResponse<InspectionTask[]>>('/inspection-tasks', { params })

export const getInspectionTask = (id: number) =>
  http.get<ApiResponse<InspectionTask>>(`/inspection-tasks/${id}`)

export const createInspectionTask = (data: Partial<InspectionTask>) =>
  http.post<ApiResponse<InspectionTask>>('/inspection-tasks', data)

export const updateInspectionTask = (id: number, data: Partial<InspectionTask>) =>
  http.put<ApiResponse<InspectionTask>>(`/inspection-tasks/${id}`, data)

export const deleteInspectionTask = (id: number) =>
  http.delete<ApiResponse>(`/inspection-tasks/${id}`)
