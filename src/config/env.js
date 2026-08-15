import 'dotenv/config';

function required(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // Fail fast and loudly rather than booting with a silently-broken config.
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim()),

  // External providers — see src/services/*Provider.js. Any of these being
  // empty means the corresponding provider runs in MOCK mode; this is
  // expected in development and must never be silently upgraded to "real"
  // in the UI (spec section 33).
  weatherApiKey: process.env.WEATHER_API_KEY || '',
  satelliteApiKey: process.env.SATELLITE_API_KEY || '',
  smsProvider: process.env.SMS_PROVIDER || 'MOCK',
  smsApiKey: process.env.SMS_API_KEY || '',
  smsApiSecret: process.env.SMS_API_SECRET || '',
  smsSender: process.env.SMS_SENDER || 'NeuronSentinel',
  aiApiKey: process.env.AI_API_KEY || '',
};