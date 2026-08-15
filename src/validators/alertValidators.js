import { z } from 'zod';

export const createAlertSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  type: z.string().min(3),
  severity: z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']),
  source: z.enum(['PREDICTION', 'MANUAL']),
  predictionId: z.string().optional(),
  zoneIds: z.array(z.string()).min(1, 'Une alerte doit concerner au moins une zone.'),
  channels: z.array(z.enum(['SMS', 'PUSH', 'DASHBOARD'])).optional().default([]),
});

// Le motif est obligatoire — spec section 11.
export const rejectAlertSchema = z.object({
  reason: z.string().trim().min(5, 'Un motif de rejet détaillé est obligatoire.'),
});

export function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Requête invalide.', errors: parsed.error.flatten() });
    }
    req.body = parsed.data;
    next();
  };
}
