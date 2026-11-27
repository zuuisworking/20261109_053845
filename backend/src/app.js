const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mongoose = require('mongoose');
const config = require('./config');
const errorMiddleware = require('./middlewares/errorMiddleware');
const requestIdMiddleware = require('./middlewares/requestId');
const AppError = require('./shared/errors/AppError');

const authRoutes = require('./modules/auth/authRoutes');
const transformerRoutes = require('./modules/transformers/transformerRoutes');
const transformerAliasRoutes = require('./modules/transformers/transformerAliasRoutes');
const measurementRoutes = require('./modules/measurements/measurementRoutes');
const customerRoutes = require('./modules/customers/customerRoutes');
const dashboardRoutes = require('./modules/dashboard/dashboardRoutes');
const guestRoutes = require('./modules/guests/guestRoutes');
const importRoutes = require('./modules/imports/importRoutes');
const exportRoutes = require('./modules/exports/exportRoutes');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', config.trustProxyHops);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  }),
);

app.use(requestIdMiddleware);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (config.isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      // Exact-origin allowlist: never reflect an arbitrary origin and never
      // emit credentialed CORS headers for an untrusted one. The rejection uses
      // the canonical origin-validation error code from the API contract.
      return callback(
        new AppError(
          'Origin tidak diizinkan.',
          403,
          null,
          'CSRF_FAILED'
        )
      );
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 600,
  }),
);

app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.urlencodedBodyLimit }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SIGAP ULP Labuhan Backend API',
    version: '1.0.0',
  });
});

app.get('/api/ready', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'not_ready',
    database: ready ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/transformers', transformerRoutes);
app.use('/api/v1/transformer-aliases', transformerAliasRoutes);
app.use('/api/v1/measurements', measurementRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/guests', guestRoutes);
app.use('/api/v1/imports', importRoutes);
app.use('/api/v1/exports', exportRoutes);

app.use('/api', (req, _res, next) => {
  next(
    new AppError(
      `Endpoint '${req.originalUrl}' tidak ditemukan pada server SIGAP.`,
      404,
      null,
      'ROUTE_NOT_FOUND'
    )
  );
});

app.use(errorMiddleware);

module.exports = app;
