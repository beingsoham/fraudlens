import { PERMISSION } from '@fraudlens/shared/constants';
import { asyncHandler, clientIp, sendData, sendPage } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';
import { userHasPermission } from '../../middleware/authorize.js';
import {
  getRelatedTransactions,
  getTransactionDetail,
  listTransactions,
} from './transactions.service.js';
import { getAccountGraph, getAccountSummary, searchAccounts } from './accounts.service.js';
import { INGESTION_SOURCE, ingestTransaction } from './ingestion.service.js';

export const list = asyncHandler(async (req, res) => {
  const params = query(req);
  const { items, total } = await listTransactions(params);
  sendPage(res, { items, total, page: params.page, pageSize: params.pageSize });
});

export const detail = asyncHandler(async (req, res) => {
  const transaction = await getTransactionDetail(req.params.id);

  // The ground-truth label exists for model evaluation, not for investigators:
  // showing it on the detail page would tell a reviewer the "answer" before
  // they formed their own judgement and would bias every outcome they record.
  if (!userHasPermission(req.user, PERMISSION.ANALYTICS_READ)) {
    transaction.groundTruthLabel = null;
  }

  sendData(res, transaction);
});

export const related = asyncHandler(async (req, res) => {
  const { limit } = query(req);
  const items = await getRelatedTransactions(req.params.id, limit);
  sendData(res, items);
});

/**
 * `POST /api/v1/transactions/ingest`
 *
 * Returns 201 for a newly ingested transaction and 200 for a duplicate, which
 * lets an at-least-once client retry safely and distinguish the two cases
 * without treating a replay as an error.
 */
export const ingest = asyncHandler(async (req, res) => {
  // `scenarioLabel` is ground truth and is only ever accepted from internal
  // callers. Stripping it here means an external client cannot plant a label
  // that would then contaminate the detection-performance metrics.
  const { scenarioLabel: _rejected, ...payload } = req.body;

  const result = await ingestTransaction(payload, {
    actorId: req.user.id,
    requestId: req.requestId,
    ipAddress: clientIp(req),
    source: INGESTION_SOURCE.API,
  });

  sendData(res, result, result.duplicate ? 200 : 201);
});

export const accountGraph = asyncHandler(async (req, res) => {
  const graph = await getAccountGraph(query(req));
  sendData(res, graph);
});

export const accountSummary = asyncHandler(async (req, res) => {
  const summary = await getAccountSummary(req.params.accountRef, query(req));
  sendData(res, summary);
});

export const accountSearch = asyncHandler(async (req, res) => {
  const { search, limit } = query(req);
  const accounts = await searchAccounts(search ?? '', limit);
  sendData(res, accounts);
});
