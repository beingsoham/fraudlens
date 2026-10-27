import { asyncHandler, clientIp, sendData } from '../../utils/http.js';
import { getSimulatorStatus, startSimulator, stopSimulator } from './simulator.service.js';
import { DEFAULT_SCENARIO_DISTRIBUTION } from './generator.js';

function writeContext(req) {
  return { actorId: req.user.id, requestId: req.requestId, ipAddress: clientIp(req) };
}

export const status = asyncHandler(async (_req, res) => {
  sendData(res, {
    ...getSimulatorStatus(),
    defaultScenarioDistribution: DEFAULT_SCENARIO_DISTRIBUTION,
  });
});

export const start = asyncHandler(async (req, res) => {
  sendData(res, await startSimulator(req.body, writeContext(req)));
});

export const stop = asyncHandler(async (req, res) => {
  sendData(res, await stopSimulator(writeContext(req)));
});
