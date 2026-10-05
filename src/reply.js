// Responding: ServiceNow -> Gmail
// Called by the ServiceNow flow (see servicenow/FLOW.md) with a case sys_id.
// Reads the case and its evidence, sends the reply from Gmail in the original thread,
// stamps the Gmail message ID on the case, and returns the result to the flow.
import * as gmail from './gmail.js';
import * as sn from './servicenow.js';
import { config } from './config.js';
import { buildReplyMime, replySubject } from './mime.js';
import { toSnDateTime } from './parser.js';
import { ORIGINAL_EMAIL_FILENAME } from './ingest.js';
import { HttpError } from './errors.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // Gmail's 25 MB limit includes base64 overhead
const inFlight = new Set();

export function renderResponse(c, signature) {
  const protocol = c.u_protocol ? ` (protocolo ${c.u_protocol})` : '';
  return [
    'Prezados,',
    '',
    `Em resposta à notificação MED referente à transação Pix ${c.u_e2e_id || '[E2E ID]'}${protocol}, segue nossa justificativa:`,
    '',
    c.u_justification.trim(),
    '',
    'Os comprovantes seguem anexos a este e-mail.',
    '',
    'Atenciosamente,',
    signature,
  ].join('\n');
}

export async function sendReplyForCase(sysId) {
  if (!/^[0-9a-f]{32}$/.test(sysId || '')) throw new HttpError(400, 'sys_id must be a 32-character ServiceNow sys_id');
  if (inFlight.has(sysId)) throw new HttpError(409, 'A reply for this case is already being sent');
  inFlight.add(sysId);

  try {
    const c = await sn.getCase(sysId);
    if (!c) throw new HttpError(404, 'Case not found');

    // Idempotent: if this case was already answered, report it instead of sending again
    if (c.u_response_gmail_id) {
      return {
        already_sent: true,
        gmail_message_id: c.u_response_gmail_id,
        sent_at: c.u_response_sent_at,
        sent_to: c.u_reply_to,
        attachment_count: null,
      };
    }
    if (c.u_med_status !== 'sending') {
      throw new HttpError(409, `Case status is "${c.u_med_status}", expected "sending"`);
    }
    if (!c.u_justification?.trim()) throw new HttpError(422, 'Case has no justification');
    if (!c.u_reply_to || !c.u_gmail_thread_id) throw new HttpError(422, 'Case is missing the original email data needed to reply');

    const evidence = (await sn.listAttachments(sysId)).filter((a) => a.file_name !== ORIGINAL_EMAIL_FILENAME);
    const files = [];
    let total = 0;
    for (const a of evidence) {
      const content = await sn.downloadAttachment(a.sys_id);
      total += content.length;
      files.push({ filename: a.file_name, contentType: a.content_type, content });
    }
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new HttpError(422, `Evidence is ${(total / 1048576).toFixed(1)} MB, over the 20 MB limit. Compress or split it.`);
    }

    const me = await gmail.getMyAddress();
    const mime = buildReplyMime({
      from: me,
      to: c.u_reply_to,
      subject: replySubject(c.u_original_subject),
      inReplyTo: c.u_rfc_message_id,
      references: c.u_references,
      text: renderResponse(c, config.signature),
      attachments: files,
    });
    const sent = await gmail.sendRaw(mime, c.u_gmail_thread_id);
    const sentAt = toSnDateTime(new Date());

    // Record the send immediately: this is what makes retries safe
    let warning;
    try {
      await sn.updateCase(sysId, { u_response_gmail_id: sent.id, u_response_sent_at: sentAt });
    } catch (err) {
      warning = `Email was sent but the case could not be stamped: ${err.message}`;
      console.error(`[reply] ${c.number}: ${warning}`);
    }

    console.log(`[reply] ${c.number} sent, Gmail message ${sent.id}`);
    return {
      already_sent: false,
      gmail_message_id: sent.id,
      sent_at: sentAt,
      sent_from: me,
      sent_to: c.u_reply_to,
      attachment_count: files.length,
      ...(warning && { warning }),
    };
  } finally {
    inFlight.delete(sysId);
  }
}
