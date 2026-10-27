import { api } from './api.js';

/**
 * Typed-ish wrappers around every endpoint the UI uses.
 *
 * Collected in one module so a route change is a one-line edit here rather than
 * a hunt through components, and so every page's data needs are visible at a
 * glance.
 */

export const authApi = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  me: (options) => api.get('/auth/me', options),
};

export const dashboardApi = {
  summary: (params, options) => api.get('/dashboard/summary', { ...options, params }),
  transactionSeries: (params, options) =>
    api.get('/dashboard/transaction-series', { ...options, params }),
  riskDistribution: (params, options) =>
    api.get('/dashboard/risk-distribution', { ...options, params }),
  topRules: (params, options) => api.get('/dashboard/top-rules', { ...options, params }),
  alertTrend: (params, options) => api.get('/dashboard/alert-trend', { ...options, params }),
  recentAlerts: (params, options) => api.get('/dashboard/recent-alerts', { ...options, params }),
  recentTransactions: (params, options) =>
    api.get('/dashboard/recent-transactions', { ...options, params }),
};

export const transactionsApi = {
  list: (params, options) => api.get('/transactions', { ...options, params }),
  detail: (id, options) => api.get(`/transactions/${id}`, options),
  related: (id, params, options) => api.get(`/transactions/${id}/related`, { ...options, params }),
  ingest: (payload) => api.post('/transactions/ingest', payload),
};

export const accountsApi = {
  graph: (params, options) => api.get('/transactions/accounts/graph', { ...options, params }),
  search: (params, options) => api.get('/transactions/accounts/search', { ...options, params }),
  summary: (accountRef, params, options) =>
    api.get(`/transactions/accounts/${encodeURIComponent(accountRef)}`, { ...options, params }),
};

export const alertsApi = {
  list: (params, options) => api.get('/alerts', { ...options, params }),
  detail: (id, options) => api.get(`/alerts/${id}`, options),
  investigators: (options) => api.get('/alerts/investigators', options),
  assign: (id, assignedToId) => api.patch(`/alerts/${id}/assignment`, { assignedToId }),
  updateStatus: (id, payload) => api.patch(`/alerts/${id}/status`, payload),
  addNote: (id, body) => api.post(`/alerts/${id}/notes`, { body }),
  notes: (id, params, options) => api.get(`/alerts/${id}/notes`, { ...options, params }),
};

export const analyticsApi = {
  overview: (params, options) => api.get('/analytics/overview', { ...options, params }),
  detectionPerformance: (params, options) =>
    api.get('/analytics/detection-performance', { ...options, params }),
  rulePerformance: (params, options) =>
    api.get('/analytics/rule-performance', { ...options, params }),
  scoreHistogram: (params, options) =>
    api.get('/analytics/score-histogram', { ...options, params }),
  exportDatasets: (options) => api.get('/analytics/export/datasets', options),
  download: (params) => api.download('/analytics/export', params),
};

export const simulatorApi = {
  status: (options) => api.get('/simulator/status', options),
  start: (payload) => api.post('/simulator/start', payload),
  stop: () => api.post('/simulator/stop'),
};

export const settingsApi = {
  rules: (options) => api.get('/settings/rules', options),
  updateRule: (ruleId, payload) => api.patch(`/settings/rules/${ruleId}`, payload),
  updateRisk: (payload) => api.patch('/settings/risk', payload),
};

export const usersApi = {
  list: (params, options) => api.get('/users', { ...options, params }),
  detail: (id, options) => api.get(`/users/${id}`, options),
  create: (payload) => api.post('/users', payload),
  update: (id, payload) => api.patch(`/users/${id}`, payload),
};

export const auditApi = {
  list: (params, options) => api.get('/audit-logs', { ...options, params }),
  facets: (options) => api.get('/audit-logs/facets', options),
};

export const healthApi = {
  // `/health` returns a flat document rather than the `{ data }` envelope, so
  // that an orchestrator's probe can read `.status` directly.
  status: (options) => api.getBare('/health', options),
};
