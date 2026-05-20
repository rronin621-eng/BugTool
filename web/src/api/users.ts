import http from './index'
import type { User, ApiResponse } from '../types'

export const getUsers = (role?: string) =>
  http.get<ApiResponse<User[]>>('/users', { params: { role } })

export const getUser = (id: number) =>
  http.get<ApiResponse<User>>(`/users/${id}`)

export const createUser = (data: Partial<User>) =>
  http.post<ApiResponse<User>>('/users', data)

export const updateUser = (id: number, data: Partial<User>) =>
  http.put<ApiResponse<User>>(`/users/${id}`, data)

export const deleteUser = (id: number) =>
  http.delete<ApiResponse>(`/users/${id}`)
