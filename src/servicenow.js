// ServiceNow REST client: Table API (cases) and Attachment API (files).
import { config } from './config.js';

const { instance, user, password, table } = config.sn;
const BASE = `${instance}/api/now`;
const AUTH = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

async function call(path, { method = 'GET', json, binary, contentType, raw = false, allow404 = false } = {}) {
  const headers = { Authorization: AUTH, Accept: raw ? '*/*' : 'application/json' };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (binary) { headers['Content-Type'] = contentType; body = binary; }

  const res = await fetch(BASE + path, { method, headers, body });
  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`ServiceNow ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  if (raw) return Buffer.from(await res.arrayBuffer());
  if (res.status === 204) return null;
  return (await res.json()).result;
}

const q = (query) => encodeURIComponent(query);
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== ''));

const CASE_FIELDS = [
  'sys_id', 'number', 'u_med_status', 'u_e2e_id', 'u_protocol', 'u_justification',
  'u_gmail_thread_id', 'u_rfc_message_id', 'u_references', 'u_original_subject',
  'u_reply_to', 'u_response_gmail_id', 'u_response_sent_at',
].join(',');

export async function getCase(sysId) {
  return call(`/table/${table}/${sysId}?sysparm_fields=${CASE_FIELDS}`, { allow404: true });
}

export async function findCaseByGmailId(gmailId) {
  const rows = await call(`/table/${table}?sysparm_query=${q(`u_gmail_message_id=${gmailId}`)}&sysparm_limit=1&sysparm_fields=sys_id,number`);
  return rows[0] ?? null;
}

export async function createCase(fields) {
  return call(`/table/${table}`, { method: 'POST', json: clean(fields) });
}

export async function updateCase(sysId, fields) {
  return call(`/table/${table}/${sysId}`, { method: 'PATCH', json: fields });
}

export async function listAttachments(caseSysId) {
  return call(`/attachment?sysparm_query=${q(`table_name=${table}^table_sys_id=${caseSysId}`)}`);
}

export async function downloadAttachment(attachmentSysId) {
  return call(`/attachment/${attachmentSysId}/file`, { raw: true });
}

export async function uploadAttachment(caseSysId, fileName, contentType, buffer) {
  const params = `table_name=${table}&table_sys_id=${caseSysId}&file_name=${q(fileName)}`;
  return call(`/attachment/file?${params}`, { method: 'POST', binary: buffer, contentType });
}
