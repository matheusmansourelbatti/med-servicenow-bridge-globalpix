// Intake: Gmail -> ServiceNow
// Triggered by Gmail push notifications (plus a periodic safety sweep).
// A notification only says "the inbox changed"; the actual work is a Gmail search for
// unprocessed MED emails. That keeps intake stateless and idempotent.
import * as gmail from './gmail.js';
import * as sn from './servicenow.js';
import { config } from './config.js';
import { parseMedEmail, addDays, toSnDateTime } from './parser.js';

export const ORIGINAL_EMAIL_FILENAME = 'original-med-email.eml';

export async function ingestNewMedEmails() {
  const labelName = config.gmail.ingestedLabel;
  const labelId = await gmail.ensureLabel(labelName);
  const ids = await gmail.listMessageIds(`${config.gmail.query} -label:${labelName}`);

  for (const id of ids) {
    try {
      // If a previous run created the case but crashed before labeling, don't duplicate it
      const existing = await sn.findCaseByGmailId(id);
      if (existing) {
        await gmail.addLabel(id, labelId);
        continue;
      }

      const msg = await gmail.getMessage(id);
      const parsed = parseMedEmail(msg.body);
      const subject = msg.headers.subject ?? '';

      const created = await sn.createCase({
        short_description: `MED ${parsed.e2eId ?? '(E2E ID not found)'} - ${parsed.reason ?? subject}`.slice(0, 160),
        description: msg.body.slice(0, 4000),
        assignment_group: config.sn.assignmentGroup,
        u_med_status: 'new',
        u_e2e_id: parsed.e2eId,
        u_protocol: parsed.protocol,
        u_amount: parsed.amount,
        u_transaction_date: parsed.transactionDate && toSnDateTime(parsed.transactionDate),
        u_reason: parsed.reason,
        u_deadline: toSnDateTime(addDays(msg.receivedAt, config.deadlineDays)),
        u_gmail_message_id: msg.id,
        u_gmail_thread_id: msg.threadId,
        u_rfc_message_id: msg.headers['message-id'],
        u_references: msg.headers.references,
        u_original_subject: subject,
        u_reply_to: msg.headers['reply-to'] ?? msg.headers.from,
      });

      // Keep the untouched original email on the case
      const raw = await gmail.getRawMessage(id);
      await sn.uploadAttachment(created.sys_id, ORIGINAL_EMAIL_FILENAME, 'message/rfc822', raw);

      if (!parsed.e2eId) {
        await sn.updateCase(created.sys_id, {
          work_notes: 'The Pix E2E ID could not be read from the email. Check the original email attached to this case.',
        });
      }

      await gmail.addLabel(id, labelId);
      console.log(`[ingest] ${created.number} created from Gmail message ${id}`);
    } catch (err) {
      // One bad email must not block the rest; it stays unlabeled and is retried on the next pass
      console.error(`[ingest] failed for Gmail message ${id}:`, err.message);
    }
  }
}

// Notifications can arrive in bursts. Run one ingestion at a time; if more arrive
// meanwhile, run exactly one more pass after the current one finishes.
let current = null;
let rerun = false;

export function requestIngest() {
  if (current) {
    rerun = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        rerun = false;
        await ingestNewMedEmails();
      } while (rerun);
    } finally {
      current = null;
    }
  })();
  return current;
}
