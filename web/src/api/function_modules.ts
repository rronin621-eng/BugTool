import http from './index'
import type { FunctionModule, ApiResponse } from '../types'

export const getFunctionModules = () =>
  http.get<ApiResponse<FunctionModule[]>>('/function-modules')

export const getFunctionModule = (id: number) =>
  http.get<ApiResponse<FunctionModule>>(`/function-modules/${id}`)

export const createFunctionModule = (data: Partial<FunctionModule>) =>
  http.post<ApiResponse<FunctionModule>>('/function-modules', data)

export const updateFunctionModule = (id: number, data: Partial<FunctionModule>) =>
  http.put<ApiResponse<FunctionModule>>(`/function-modules/${id}`, data)

export const deleteFunctionModule = (id: number) =>
  http.delete<ApiResponse>(`/function-modules/${id}`)
