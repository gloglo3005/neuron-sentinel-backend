import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { isAllowedOrigin } from './config/corsOrigins.js';
import routes from './routes/index.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export const app = express();

// Render (et la plupart des PaaS) place l'appli derrière un reverse proxy
// qui ajoute X-Forwarded-For. Sans "trust proxy", Express refuse de faire
// confiance à cet en-tête et express-rate-limit lève ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// (il ne sait pas s'il peut identifier les clients par IP en toute sécurité).
// "1" = on fait confiance à un seul saut de proxy en amont, ce qui
// correspond au déploiement Render (single hop). Voir
// https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 1);

app.use(helmet());

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