import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';

  // ── Security headers (Helmet) ────────────────────────────────────────────
  app.use(
    helmet({
      // Swagger UI needs inline styles/scripts; relax CSP outside production only
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── HTTPS-ready: trust reverse-proxy (Render/Vercel/NGINX) for real IPs ───
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // ── CORS — explicit allow-list, credentials, limited methods ─────────────
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  // ── Input validation + sanitization ──────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // reject unknown properties
      transform: true, // auto-cast types
      transformOptions: { enableImplicitConversion: true },
      forbidUnknownValues: true,
      validationError: { target: false, value: false }, // don't echo input back
    }),
  );

  app.setGlobalPrefix('api');

  // ── Swagger (disabled in production unless explicitly enabled) ────────────
  if (!isProd || process.env.ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('HSNT WMS API')
      .setDescription('Warehouse Management System API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // ── Graceful shutdown hooks ──────────────────────────────────────────────
  app.enableShutdownHooks();

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`WMS API running on http://localhost:${port} [${process.env.NODE_ENV ?? 'development'}]`);
  if (!isProd) logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
