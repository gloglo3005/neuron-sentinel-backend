import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().min(6),
  password: z.string().min(6),
});

export const loginSchema = z.object({
  phone: z.string().trim().min(6),
  password: z.string().min(1),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createReportSchema = z.object({
  type: z.enum(['FLOOD', 'IMPASSABLE_ROAD', 'RISING_WATER', 'PERSON_IN_DANGER', 'DAMAGED_INFRASTRUCTURE', 'OTHER']),
  description: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  media: z.array(z.object({ type: z.string(), url: z.string().url() })).optional(),
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
