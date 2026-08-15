import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export const app = express();

app.use(helmet());
// CORS is locked to a known set of origins — this API is not a public API.
// env.corsOrigin holds the fixed origins (localhost dev ports + the main
// production Vercel URL). On top of that we also accept any Vercel
// *preview* deployment URL for this project (e.g.
// https://neuron-sentinel-83oqbmgj0-glorie.vercel.app or
// https://neuron-sentinel-dashboard-3swvfuz8r-glorie.vercel.app), since
// Vercel mints a new one on every preview build across every Vercel
// project we have (pwa, dashboard, ...) and we don't want to hand-edit
// CORS_ORIGIN each time. Matches any subdomain starting with
// "neuron-sentinel-" and ending in "-glorie.vercel.app". Adjust if the
// Vercel account/team slug ("glorie") ever changes.
const VERCEL_PREVIEW_REGEX = /^https:\/\/neuron-sentinel-[a-z0-9-]+-glorie\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser requests (curl, server-to-server, health checks)
  if (env.corsOrigin.includes(origin)) return true;
  return VERCEL_PREVIEW_REGEX.test(origin);
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '2mb' }));
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);