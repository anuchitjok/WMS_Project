import { ValidationPipe } from '@nestjs/common';

/** The global input validation used by main.ts (and by tests, so they validate exactly like production). */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true, // strip unknown properties
    forbidNonWhitelisted: true, // reject unknown properties
    transform: true, // auto-cast types
    transformOptions: { enableImplicitConversion: true },
    forbidUnknownValues: true,
    validationError: { target: false, value: false }, // don't echo input back
  });
}
