import { PERMISSION } from '@fraudlens/shared/constants';
import { asyncHandler, clientIp, sendData } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';
import { userHasPermission } from '../../middleware/authorize.js';
import { AuthorizationError } from '../../utils/errors.js';
import {
  getAnalyticsOverview,
  getDetectionPerformance,
  getRulePerformance,
  getScoreHistogram,
} from './analytics.service.js';
import {
  EXPORTABLE_DATASETS,
  buildExport,
  datasetRequiresAuditPermission,
} from './export.service.js';

export const overview = asyncHandler(async (req, res) => {
  sendData(res, await getAnalyticsOverview(query(req)));
});

export const detectionPerformance = asyncHandler(async (req, res) => {
  sendData(res, await getDetectionPerformance(query(req)));
});

export const rulePerformance = asyncHandler(async (req, res) => {
  sendData(res, await getRulePerformance(query(req)));
});

export const scoreHistogram = asyncHandler(async (req, res) => {
  sendData(res, await getScoreHistogram(query(req)));
});

export const datasets = asyncHandler(async (req, res) => {
  const canReadAudit = userHasPermission(req.user, PERMISSION.AUDIT_READ);
  sendData(
    res,
    EXPORTABLE_DATASETS.filter((dataset) => !dataset.requiresAuditPermission || canReadAudit),
  );
});

/**
 * `GET /api/v1/analytics/export`
 *
 * The audit-log dataset carries actor identities and request metadata, so it
 * requires `audit:read` in addition to the export permission. Without this
 * check, export would be a way around the audit viewer's authorization.
 */
export const exportCsv = asyncHandler(async (req, res) => {
  const params = query(req);

  if (
    datasetRequiresAuditPermission(params.dataset) &&
    !userHasPermission(req.user, PERMISSION.AUDIT_READ)
  ) {
    throw new AuthorizationError('Exporting audit logs requires the audit:read permission');
  }

  const { filename, csv, rowCount } = await buildExport(params, {
    actorId: req.user.id,
    requestId: req.requestId,
    ipAddress: clientIp(req),
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Row-Count', String(rowCount));
  // Prevents a browser or proxy from sniffing the response as something else.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(csv);
});
