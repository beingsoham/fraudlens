import { asyncHandler, clientIp, sendData } from '../../utils/http.js';
import { getRuleSettings, updateRiskSettings, updateRule } from './settings.service.js';

function writeContext(req) {
  return { actorId: req.user.id, requestId: req.requestId, ipAddress: clientIp(req) };
}

export const getRules = asyncHandler(async (_req, res) => {
  sendData(res, await getRuleSettings());
});

export const patchRule = asyncHandler(async (req, res) => {
  sendData(res, await updateRule(req.params.ruleId, req.body, writeContext(req)));
});

export const patchRiskSettings = asyncHandler(async (req, res) => {
  sendData(res, await updateRiskSettings(req.body, writeContext(req)));
});
