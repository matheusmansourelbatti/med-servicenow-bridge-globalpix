# ServiceNow: "MED - Send approved response" flow

Flow Designer flows are built in the UI (they export as update set XML from an instance,
not as hand-written code). This is the exact build spec. It takes about 20 minutes.

The flow fires when a case is approved, marks it `sending`, calls the bridge to send the
reply from Gmail, and records the outcome on the case.

```
Case status -> approved
        │
        ▼
[1] Update record: status = sending
        │
        ▼
[2] Action "Send MED reply via bridge" ──REST──▶ bridge /servicenow/send-reply ──▶ Gmail
        │ outputs: success, message, gmail_message_id ...
        ▼
[3] If success ──yes──▶ status = responded, work note
        └─────────no──▶ status = send_failed, work note with the error
```

## 1. Connection & Credential alias

**Connections & Credentials → Credentials → New → Basic Auth Credentials**
- Name: `MED Bridge Basic Auth`
- User name / Password: the `BRIDGE_USER` / `BRIDGE_PASSWORD` values from the bridge's environment

**Connections & Credentials → Connection & Credential Aliases → New**
- Name: `MED Bridge`, Type: `Connection and Credential`

Open the alias, under **Connections → New → HTTP(s) Connection**
- Name: `MED Bridge (prod)`
- Credential: `MED Bridge Basic Auth`
- Connection URL: the bridge's `PUBLIC_URL` (for example `https://med-bridge-xxxx.a.run.app`)

## 2. Action: "Send MED reply via bridge"

**Flow Designer → New → Action**, name `Send MED reply via bridge`.

**Inputs**
| Label | Name | Type | Mandatory |
|---|---|---|---|
| Case sys_id | `case_sys_id` | String | yes |

**Step 1: REST** (the REST step comes with IntegrationHub, which developer instances include)
- Connection: **Use Connection Alias** → `MED Bridge`
- Resource Path: `/servicenow/send-reply`
- HTTP Method: `POST`
- Headers: `Content-Type` = `application/json`, `Accept` = `application/json`
- Request Type: Text, Request Body:
  ```
  {"sys_id":"<drag the Case sys_id input pill here>"}
  ```
- Retry policy: none. The flow handles failures, and the bridge is idempotent if you re-approve.
- Under the step's error handling, choose to **continue** on errors, so non-2xx responses reach the
  script step instead of failing the action. (The exact label varies by release.)

**Step 2: Script**
- Inputs: `status_code` ← REST step **Status Code**, `response_body` ← REST step **Response Body**
- Outputs: `success` (True/False), `already_sent` (True/False), `gmail_message_id` (String),
  `sent_to` (String), `attachment_count` (Integer), `message` (String)
- Script: paste `action_script_parse_bridge_response.js`

**Action outputs**: create the same six outputs and map each to the Script step output of the same name.

Save, then **Publish**.

## 3. Flow: "MED - Send approved response"

**Flow Designer → New → Flow**, name `MED - Send approved response`, Run as: **System User**.

**Trigger**
- Type: **Updated**, Table: `MED Case [u_med_case]`
- Condition: `MED status` **changes to** `approved`
- Run Trigger: **For each unique change**

**Actions**
1. **Update Record**: Record = Trigger ▸ MED Case Record; `MED status` = `sending`
2. **Send MED reply via bridge**: Case sys_id = Trigger ▸ MED Case Record ▸ Sys ID
3. **Flow Logic → If**: condition `2 ▸ success` is `true`
   - **Update Record**: Trigger record; `MED status` = `responded`; `Work notes` = `2 ▸ message`
4. **Flow Logic → Else**
   - **Update Record**: Trigger record; `MED status` = `send_failed`; `Work notes` = `2 ▸ message`

Optional: add a **Send Notification** (or Send Email) under the Else branch to alert the
assignment group when sending fails.

Save, **Test** with a case (Flow Designer's Test button runs it against a record you pick),
then **Activate**.

## Retrying a failed send

Fix the cause (shown in the work note), then set the status back to `approved`. The flow runs
again. If the earlier attempt actually reached Gmail, the bridge sees the Gmail message ID on the
case and reports "already sent" instead of sending a duplicate.

## Why the order of operations matters

- The **business rule** (`before` update) validates and records the approver before the flow sees the change.
- Step 1 (`sending`) happens before the call, so the case visibly shows a send in progress.
- The bridge stamps `u_response_gmail_id` itself the moment Gmail accepts the email, so a send is
  never lost even if the flow's last step fails.
