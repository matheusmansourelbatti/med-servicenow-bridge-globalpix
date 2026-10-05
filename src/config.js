import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

const list = (value) => (value || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 8080),
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    refreshToken: required('GOOGLE_REFRESH_TOKEN'),
    pubsubTopic: process.env.GMAIL_PUBSUB_TOPIC || '',
    allowedInvokers: list(process.env.ALLOWED_INVOKERS),
    startWatchOnBoot: process.env.START_WATCH_ON_BOOT === 'true',
  },
  gmail: {
    query: process.env.GMAIL_MED_QUERY || 'subject:MED',
    ingestedLabel: process.env.GMAIL_INGESTED_LABEL || 'MED-Ingested',
  },
  sn: {
    instance: required('SN_INSTANCE').replace(/\/$/, ''),
    user: required('SN_USER'),
    password: required('SN_PASSWORD'),
    table: process.env.SN_TABLE || 'u_med_case',
    assignmentGroup: process.env.SN_ASSIGNMENT_GROUP || '',
  },
  bridge: {
    user: required('BRIDGE_USER'),
    password: required('BRIDGE_PASSWORD'),
  },
  deadlineDays: Number(process.env.RESPONSE_DEADLINE_DAYS || 3),
  signature: process.env.SIGNATURE || 'Pix Global',
};
