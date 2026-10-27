import { asyncHandler, sendData } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';
import {
  getAlertTrend,
  getDashboardSummary,
  getRecentAlerts,
  getRecentTransactions,
  getRiskDistribution,
  getTopRules,
  getTransactionSeries,
} from './dashboard.service.js';

export const summary = asyncHandler(async (req, res) => {
  sendData(res, await getDashboardSummary(query(req)));
});

export const transactionSeries = asyncHandler(async (req, res) => {
  sendData(res, await getTransactionSeries(query(req)));
});

export const riskDistribution = asyncHandler(async (req, res) => {
  sendData(res, await getRiskDistribution(query(req)));
});

export const topRules = asyncHandler(async (req, res) => {
  sendData(res, await getTopRules(query(req)));
});

export const alertTrend = asyncHandler(async (req, res) => {
  sendData(res, await getAlertTrend(query(req)));
});

export const recentAlerts = asyncHandler(async (req, res) => {
  const { limit } = query(req);
  sendData(res, await getRecentAlerts(limit));
});

export const recentTransactions = asyncHandler(async (req, res) => {
  const { limit } = query(req);
  sendData(res, await getRecentTransactions(limit));
});
