// Builds the Express app (no listening here, so tests can import it with supertest).
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimits.js';
import { requireDb } from './middleware/requireDb.js';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import healthRoutes from './routes/health.js';
import fieldRoutes from './routes/fields.js';
import historyRoutes from './routes/history.js';
import placesRoutes from './routes/places.js';
import predictRoutes from './routes/predict.js';
import recommendRoutes from './routes/recommend.js';
import weatherRoutes from './routes/weather.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // correct client IPs for rate limiting behind a proxy

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRoutes);
  app.use('/api', apiLimiter);
  app.use('/api/weather', weatherRoutes); // works without a database
  app.use('/api/places', placesRoutes);   // address search / reverse geocoding / PIN codes, no database
  app.use('/api/auth', requireDb, authRoutes);
  app.use('/api/predict', requireDb, predictRoutes);
  app.use('/api/history', requireDb, historyRoutes);
  app.use('/api/fields', requireDb, fieldRoutes);
  app.use('/api/recommend', requireDb, recommendRoutes);
  app.use('/api/chat', requireDb, chatRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
