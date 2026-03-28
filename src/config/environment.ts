import * as dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

export const config = {
  browserbase: {
    apiKey: requireEnv('BROWSERBASE_API_KEY'),
    projectId: requireEnv('BROWSERBASE_PROJECT_ID'),
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
    heliconeApiKey: optionalEnv('HELICONE_API_KEY'),
  },
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },
  agentql: {
    apiKey: requireEnv('AGENTQL_API_KEY'),
  },
  trigger: {
    secretKey: requireEnv('TRIGGER_SECRET_KEY'),
  },
  resend: {
    apiKey: requireEnv('RESEND_API_KEY'),
    fromEmail: requireEnv('FROM_EMAIL'),
  },
  twilio: {
    accountSid: optionalEnv('TWILIO_ACCOUNT_SID'),
    authToken: optionalEnv('TWILIO_AUTH_TOKEN'),
    whatsappFrom: optionalEnv('TWILIO_WHATSAPP_FROM'),
  },
  pagespeed: {
    apiKey: optionalEnv('PAGESPEED_API_KEY'),
  },
  reportOutputDir: optionalEnv('REPORT_OUTPUT_DIR', './reports'),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
};