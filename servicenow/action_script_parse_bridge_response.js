/*
 * Flow Designer: Script step inside the "Send MED reply via bridge" action.
 *
 * Script step inputs (map from the REST step's data pills):
 *   status_code    (Integer)  <- REST step > Status Code
 *   response_body  (String)   <- REST step > Response Body
 *
 * Script step outputs (create these with these exact names and types):
 *   success           (True/False)
 *   already_sent      (True/False)
 *   gmail_message_id  (String)
 *   sent_to           (String)
 *   attachment_count  (Integer)
 *   message           (String)   human-readable summary or error, used in work notes
 */
(function execute(inputs, outputs) {
  var code = parseInt(inputs.status_code, 10) || 0;
  var body = {};

  outputs.success = false;
  outputs.already_sent = false;

  try {
    body = JSON.parse(inputs.response_body || '{}');
  } catch (e) {
    outputs.message = 'Bridge returned a non-JSON response (HTTP ' + code + ').';
    return;
  }

  if (code < 200 || code >= 300) {
    outputs.message = 'Bridge error (HTTP ' + code + '): ' + (body.error || 'no details');
    return;
  }

  outputs.success = true;
  outputs.already_sent = body.already_sent === true;
  outputs.gmail_message_id = body.gmail_message_id || '';
  outputs.sent_to = body.sent_to || '';
  outputs.attachment_count = body.attachment_count || 0;

  if (outputs.already_sent) {
    outputs.message = 'Response had already been sent earlier (Gmail message ' + outputs.gmail_message_id + '). Nothing re-sent.';
  } else {
    outputs.message = 'Response sent to ' + outputs.sent_to + ' with ' + outputs.attachment_count +
      ' attachment(s). Gmail message ' + outputs.gmail_message_id + '.';
  }
  if (body.warning) outputs.message += ' Warning: ' + body.warning;
})(inputs, outputs);
