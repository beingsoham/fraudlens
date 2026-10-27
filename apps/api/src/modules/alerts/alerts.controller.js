import { asyncHandler, clientIp, sendData, sendPage } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';
import {
  addInvestigationNote,
  assignAlert,
  getAlert,
  listAlerts,
  listAssignableInvestigators,
  listInvestigationNotes,
  updateAlertStatus,
} from './alerts.service.js';

/** Pulls the actor and request metadata every write path needs. */
function writeContext(req) {
  return {
    actorId: req.user.id,
    requestId: req.requestId,
    ipAddress: clientIp(req),
  };
}

export const list = asyncHandler(async (req, res) => {
  const params = query(req);
  const { items, total } = await listAlerts(params, req.user.id);
  sendPage(res, { items, total, page: params.page, pageSize: params.pageSize });
});

export const detail = asyncHandler(async (req, res) => {
  sendData(res, await getAlert(req.params.id));
});

export const patchAssignment = asyncHandler(async (req, res) => {
  const alert = await assignAlert(req.params.id, req.body.assignedToId, writeContext(req));
  sendData(res, alert);
});

export const patchStatus = asyncHandler(async (req, res) => {
  const alert = await updateAlertStatus(req.params.id, req.body, writeContext(req));
  sendData(res, alert);
});

export const createNote = asyncHandler(async (req, res) => {
  const note = await addInvestigationNote(req.params.id, req.body.body, writeContext(req));
  sendData(res, note, 201);
});

export const listNotes = asyncHandler(async (req, res) => {
  const params = query(req);
  const { items, total } = await listInvestigationNotes(req.params.id, params);
  sendPage(res, { items, total, page: params.page, pageSize: params.pageSize });
});

export const investigators = asyncHandler(async (_req, res) => {
  sendData(res, await listAssignableInvestigators());
});
