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
// CORS is locked to the dashboard's own origin — this API is not a public
// API, it exists to serve one authenticated authority dashboard.
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);
