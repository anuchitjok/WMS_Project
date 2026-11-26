import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Change-password request.
 *
 * The controller previously declared this body as an inline TypeScript type, which is
 * erased at runtime: the ValidationPipe had nothing to validate, so a caller sending the
 * wrong field name (or omitting a field) passed `undefined` into `bcrypt.compare` and got
 * HTTP 500 "Illegal arguments: undefined, string" instead of a 400 (WMS-01-004).
 *
 * Password *strength* is deliberately left to `validatePasswordPolicy` in the service,
 * which owns the policy and reports every rule that failed.
 */
export class ChangePasswordDto {
  @ApiProperty({ description: 'The current password, for re-authentication' })
  @IsString()
  @IsNotEmpty({ message: 'oldPassword is required' })
  @MaxLength(200)
  oldPassword: string;

  @ApiProperty({ description: 'The new password. Strength rules are enforced by the password policy.' })
  @IsString()
  @IsNotEmpty({ message: 'newPassword is required' })
  @MaxLength(200)
  newPassword: string;
}
