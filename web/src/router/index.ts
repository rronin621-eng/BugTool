import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/bugs',
    },
    {
      path: '/bugs',
      name: 'BugList',
      component: () => import('../views/BugList.vue'),
    },
    {
      path: '/bugs/:id',
      name: 'BugDetail',
      component: () => import('../views/BugDetail.vue'),
    },
    {
      path: '/users',
      name: 'UserManage',
      component: () => import('../views/UserManage.vue'),
    },
    {
      path: '/inspection-tasks',
      name: 'InspectionTaskManage',
      component: () => import('../views/InspectionTaskManage.vue'),
    },
    {
      path: '/function-modules',
      name: 'FunctionModuleManage',
      component: () => import('../views/FunctionModuleManage.vue'),
    },
  ],
})

export default router
