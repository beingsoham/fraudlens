import { asyncHandler, clientIp, sendData, sendPage } from '../../utils/http.js';
import { query } from '../../middleware/validate.js';
import { createUser, getUser, listUsers, updateUser } from './users.service.js';

function writeContext(req) {
  return { actorId: req.user.id, requestId: req.requestId, ipAddress: clientIp(req) };
}

export const list = asyncHandler(async (req, res) => {
  const params = query(req);
  const { items, total } = await listUsers(params);
  sendPage(res, { items, total, page: params.page, pageSize: params.pageSize });
});

export const detail = asyncHandler(async (req, res) => {
  sendData(res, await getUser(req.params.id));
});

export const create = asyncHandler(async (req, res) => {
  sendData(res, await createUser(req.body, writeContext(req)), 201);
});

export const patch = asyncHandler(async (req, res) => {
  sendData(res, await updateUser(req.params.id, req.body, writeContext(req)));
});
