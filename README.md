# MED ServiceNow Bridge

Automates responses to Pix MED notifications received by email from the banking partner.

- **Intake:** Gmail push notifications open a MED case in ServiceNow within seconds of the email arriving, with the transaction data parsed, a 3-day deadline, and the original email attached.
- **Response:** when a case is approved, a ServiceNow flow calls this service, which sends the justification and evidence **from the company Gmail account, as a reply in the original thread**, and the outcome is recorded on the case.

```
                    ┌──────────────────────── Google Cloud ────────────────────────┐
 Partner ──email──▶ Gmail ──watch──▶ Pub/Sub ──push (OIDC)──▶ Cloud Run: bridge   │
                    │                                   Scheduler ──▶ /tasks/*    │
                    └────────────────────────────────────────────────────┬─────────┘
                                                                         │ Table + Attachment API
                                                                         ▼
                                                               ServiceNow: MED Case
                                                               SLA · business rule
                                                               support adds evidence
                                                               approver approves
                                                                         │
                                         Flow Designer flow ──REST (Basic)┘
                                                 │
 Partner ◀──reply in thread, with evidence── Gmail ◀── bridge /servicenow/send-reply
```

## Repository layout

| Path | Purpose |
|---|---|
| `src/index.js` | Starts the HTTP server; registers the Gmail watch and runs a catch-up sweep on boot |
| `src/server.js` | HTTP routes and per-route authentication |
| `src/ingest.js` | Intake: Gmail search → parse → create case → attach original → label |
| `src/reply.js` | Response: load case + evidence → send from Gmail → stamp case → return result |
| `src/gmail.js` | Gmail API client (watch, search, read, label, send) |
| `src/servicenow.js` | ServiceNow Table API and Attachment API client |
| `src/parser.js` | Extracts E2E ID, amount, date, reason and protocol from the email text |
| `src/mime.js` | Builds the threaded reply email with attachments |
| `src/auth.js`, `src/basic-auth.js` | Google OIDC verification and Basic auth check |
| `servicenow/FLOW.md` | Build spec for the Flow Designer action and flow |
| `servicenow/action_script_parse_bridge_response.js` | Script step used inside the flow action |
| `servicenow/business_rule_approval_guard.js` | Approval rules enforced inside ServiceNow |
| `deploy/setup-gcp.sh` | Creates Pub/Sub, Cloud Run, push subscription and scheduler jobs |
| `scripts/get-refresh-token.js` | One-time Google login that produces the Gmail refresh token |
| `scripts/start-watch.js` | Registers the Gmail watch manually (local runs) |

## Case lifecycle

| Status | Set by | Meaning |
|---|---|---|
| `new` | bridge | Case created from the notification |
| `gathering_evidence` | support | Evidence being collected |
| `awaiting_approval` | support | Justification and evidence ready for review |
| `approved` | approver | Starts the response flow |
| `sending` | flow | Response in progress |
| `responded` | flow | Reply sent; Gmail message ID and time on the case |
| `send_failed` | flow | Error in work notes; fix it and set `approved` again |
| `closed` | anyone | Partner's final decision recorded |

## HTTP endpoints

| Route | Caller | Auth |
|---|---|---|
| `GET /healthz` | anyone | none |
| `POST /gmail/push` | Pub/Sub push subscription | Google OIDC token, allow-listed service account |
| `POST /tasks/renew-watch` | Cloud Scheduler, daily | Google OIDC |
| `POST /tasks/sweep` | Cloud Scheduler, every 30 min | Google OIDC |
| `POST /servicenow/send-reply` | ServiceNow flow | HTTP Basic |

`/servicenow/send-reply` takes `{"sys_id": "..."}` and returns
`{ already_sent, gmail_message_id, sent_at, sent_from, sent_to, attachment_count }`.
Errors return `{ "error": "..." }` with 400, 401, 404, 409, 422 or 500.

---

## Setup

### 1. Google OAuth client (Gmail access)

1. In Google Cloud Console, create or pick a project. On the **OAuth consent screen**, choose External and add the company Gmail account as a test user.
2. **Credentials → Create OAuth client ID → Desktop app.** Put the ID and secret in `.env` (copy from `.env.example`).
3. `npm install`, then `npm run auth`. Open the URL, sign in with the company Gmail account, approve. Put the printed `GOOGLE_REFRESH_TOKEN` in `.env`.

Scope: `gmail.modify` (read, label, send; no permanent deletion).
While the consent screen is in Testing mode, refresh tokens expire after 7 days. Publish the app for continuous operation.

### 2. ServiceNow

**Table.** System Definition → Tables → New: label `MED Case`, name `u_med_case`, **extends Task**, auto-number prefix `MED`.

**Columns**

| Column | Type | Notes |
|---|---|---|
| `u_med_status` | Choice | new, gathering_evidence, awaiting_approval, approved, sending, responded, send_failed, closed |
| `u_e2e_id` | String (40) | Pix end-to-end ID |
| `u_protocol` | String (100) | Partner's protocol number |
| `u_amount` | Decimal | |
| `u_transaction_date` | Date/Time | |
| `u_reason` | String (1000) | |
| `u_deadline` | Date/Time | Received time + `RESPONSE_DEADLINE_DAYS` |
| `u_justification` | String (4000) | Written by support |
| `u_approved_by` | Reference → User | Set by the business rule |
| `u_gmail_message_id` | String (100) | Intake idempotency key |
| `u_gmail_thread_id` | String (100) | Thread to reply in |
| `u_rfc_message_id` | String (255) | Original `Message-ID` header |
| `u_references` | String (4000) | Original `References` header |
| `u_original_subject` | String (255) | |
| `u_reply_to` | String (255) | Reply recipient |
| `u_response_sent_at` | Date/Time | Stamped by the bridge |
| `u_response_gmail_id` | String (100) | Stamped by the bridge; prevents duplicate sends |

Show the business fields on the form; the Gmail fields can stay hidden or read-only.

**Role.** Create the role `med_approver` and assign it to whoever approves responses.

**Integration user.** Create `med.integration` with **Web service access only**, and give it read/write on `u_med_case` and `sys_attachment` for that table (ACLs or a scoped role). Its credentials go in `SN_USER` / `SN_PASSWORD`.

**SLA.** Service Level Management → SLA Definitions → New: table `MED Case`, duration 3 days, 24x7, start when status is `new`, stop when status is `responded` or `closed`. Add breach warnings at 50% and 75% if wanted.

**Business rule.** Create it as described at the top of `servicenow/business_rule_approval_guard.js`.

**Flow.** Build the connection alias, action and flow following `servicenow/FLOW.md`.

### 3. Deploy

**Cloud Run (recommended).** Fill in `.env` (leave `PUBLIC_URL` empty), then:

```bash
PROJECT_ID=your-project ./deploy/setup-gcp.sh
```

It enables the APIs, creates the Pub/Sub topic and lets Gmail publish to it, creates the invoker service account, and deploys the service. It then sets `PUBLIC_URL`, creates the authenticated push subscription, and schedules the daily watch renewal and the 30-minute sweep. The printed URL is the Connection URL for the `MED Bridge` alias in ServiceNow.

**Local.** Expose the service with a tunnel such as ngrok, set `PUBLIC_URL` to the tunnel URL, point the Pub/Sub push subscription at `<tunnel>/gmail/push`, then `npm start`. Run `npm run watch` to register the watch, since Cloud Scheduler won't be renewing it.

### 4. Verify end to end

1. Temporarily set `GMAIL_MED_QUERY=subject:"[TEST MED]"`.
2. From another mailbox, send the company Gmail an email with subject `[TEST MED] Notificação` and a body like the sample in `test/parser.test.js`.
3. A `MED…` case appears in ServiceNow within seconds, with parsed fields, deadline, SLA, and the original `.eml` attached.
4. Attach a PDF, write a justification, set `awaiting_approval`, then approve as a `med_approver`.
5. The sending mailbox receives the reply in the same thread, with the PDF. The case moves to `responded` with the Gmail message ID and a work note.

Run `npm test` for the offline unit tests (parser, email builder, Basic auth).

---

## Configuration

| Variable | Description |
|---|---|
| `PORT` | HTTP port (Cloud Run sets it) |
| `PUBLIC_URL` | Public base URL; also the expected audience of Google-signed tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Gmail OAuth |
| `GMAIL_PUBSUB_TOPIC` | `projects/<id>/topics/<topic>` |
| `ALLOWED_INVOKERS` | Service accounts accepted on `/gmail/push` and `/tasks/*` |
| `START_WATCH_ON_BOOT` | Register the watch and sweep on startup |
| `GMAIL_MED_QUERY` | Gmail search identifying MED notifications |
| `GMAIL_INGESTED_LABEL` | Label applied after a case is created |
| `SN_INSTANCE`, `SN_USER`, `SN_PASSWORD`, `SN_TABLE` | ServiceNow access |
| `SN_ASSIGNMENT_GROUP` | Optional sys_id of the support group |
| `BRIDGE_USER`, `BRIDGE_PASSWORD` | Basic auth the ServiceNow flow uses |
| `RESPONSE_DEADLINE_DAYS` | Deadline offset from the email's arrival |
| `SIGNATURE` | Signature line of the reply |

## How it works

**Intake.** Gmail's watch publishes to Pub/Sub on every inbox change, and Pub/Sub pushes a signed request to `/gmail/push`. The notification is used only as a trigger. The bridge then searches Gmail for MED emails without the ingested label, so missed, duplicated or out-of-order notifications don't matter. Each email is parsed and turned into a case, the raw `.eml` is attached, and the email is labeled. Before creating a case, the bridge looks it up by Gmail message ID, so a crash between "case created" and "email labeled" never produces duplicates. Bursts of notifications are coalesced into at most one extra pass. Watches expire after 7 days, so they're renewed daily; a 30-minute sweep covers any notification Google drops.

**Response.** Approval is validated inside ServiceNow by the business rule. The flow marks the case `sending` and calls `/servicenow/send-reply`. The bridge loads the case and its evidence, excluding the original email. It builds a UTF-8 reply with `In-Reply-To` and `References` headers and sends it through the Gmail API with the original `threadId`. Right after Gmail accepts it, the bridge stamps `u_response_gmail_id` and `u_response_sent_at` on the case. A repeated call for the same case returns `already_sent: true` instead of sending again. The flow writes the final status and a work note.

## Operations

- **Send failed:** the work note has the reason (missing justification, evidence over 20 MB, auth error, etc.). Fix it and set the status back to `approved`.
- **Case stuck in `sending`:** the flow didn't finish. If `u_response_gmail_id` is filled, the email went out; set `responded`. If not, set `approved` to retry.
- **No new cases:** check the Cloud Run logs for `[push]` lines. Run the sweep job manually from Cloud Scheduler and confirm the watch was renewed (`[watch] active until …`).
- **Fields empty on new cases:** the notification layout differs from the parser's patterns. Adjust `src/parser.js` and add the real layout to `test/parser.test.js`.

## Security

- Gmail access is a single refresh token with `gmail.modify` scope. Store it in Secret Manager rather than plain environment variables in production.
- Google-originated routes accept only OIDC tokens issued for `PUBLIC_URL` to the allow-listed service account. The ServiceNow route uses Basic auth over HTTPS, stored in a ServiceNow credential record.
- The ServiceNow integration user is web-service-only and should be limited to the MED table and its attachments.
- Nothing is sent to the partner without an approval by a `med_approver`, enforced server-side in ServiceNow.

## Known limitations

- The parser relies on the notification's wording. A structured API or webhook from the partner, if available, would replace email parsing.
- Duplicate-send protection inside the bridge is per instance. The deploy script caps Cloud Run at one instance; scaling out would need a shared lock.
- Evidence is limited to 20 MB per reply by Gmail's size limit.
