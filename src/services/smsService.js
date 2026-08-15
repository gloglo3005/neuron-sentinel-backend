import { env } from '../config/env.js';

// SMSProvider interface (spec section 29): sendSMS(phone, message).
// MOCK mode is the default (SMS_PROVIDER=MOCK, or missing SMS_API_KEY) —
// it logs the message instead of sending it and returns a status the
// caller can persist to Notification.status, so nothing pretends a real
// SMS went out until a real provider is configured.
export const smsService = {
  isMock: env.smsProvider === 'MOCK' || !env.smsApiKey,

  async sendSMS(phone, message) {
    if (this.isMock) {
      console.log(`[MOCK SMS] to=${phone} :: ${message}`);
      return { status: 'SENT', provider: 'MOCK', sentAt: new Date().toISOString() };
    }
    // Real implementation would call the configured SMS_PROVIDER's HTTP API
    // here using SMS_API_KEY / SMS_API_SECRET / SMS_SENDER.
    throw new Error(`SMSProvider '${env.smsProvider}' réel non implémenté.`);
  },
};
