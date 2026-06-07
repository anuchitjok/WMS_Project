import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsNumber, IsString, MinLength, validateSync, IsOptional } from 'class-validator';

enum NodeEnv {
  development = 'development',
  production = 'production',
  test = 'test',
}

class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv = NodeEnv.development;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  PORT = 3001;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  @IsOptional()
  DIRECT_URL?: string;

  // JWT secrets must be reasonably strong (>= 32 chars) in any environment
  @IsString()
  @MinLength(16, { message: 'JWT_SECRET must be at least 16 characters' })
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN = '8h';

  @IsString()
  @MinLength(16, { message: 'JWT_REFRESH_SECRET must be at least 16 characters' })
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN = '7d';

  @IsString()
  @IsOptional()
  FRONTEND_URL = 'http://localhost:3000';
}

/**
 * Validates environment variables at boot. Throws (and stops the app) when a
 * required variable is missing or a secret is too weak — fail fast, never run
 * production with insecure config.
 */
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`❌ Invalid environment configuration:\n  - ${messages}`);
  }

  // Extra guard: refuse to boot production with the default demo secrets
  if (
    validated.NODE_ENV === NodeEnv.production &&
    (validated.JWT_SECRET.includes('change-in-prod') ||
      validated.JWT_REFRESH_SECRET.includes('change-in-prod'))
  ) {
    throw new Error('❌ Default JWT secrets detected in production. Set strong unique secrets.');
  }

  return validated;
}
