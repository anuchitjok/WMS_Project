import { passwordPolicyErrors } from '../common/password-policy';
import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { hashPassword, needsRehash } from './password';
import { randomUUID } from 'node:crypto';
import { GrantActor, assertCanGrantLegacyRole } from './role-grant';
import { MasterDataService } from '../master-data/master-data.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenBlocklistService } from './token-blocklist.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private blocklist: TokenBlocklistService,
    private masterData: MasterDataService,
  ) {}

  // Invalidate token on logout
  async logout(token: string, userId: string) {
    try {
      const payload: any = this.jwt.decode(token);
      if (payload?.jti && payload?.exp) {
        await this.blocklist.revoke(payload.jti, userId, new Date(payload.exp * 1000));
      }
    } catch { /* invalid token, ignore */ }
    await this.prisma.auditLog.create({ data: { userId, action: 'LOGOUT', entityType: 'User', entityId: userId } });
    return { message: 'Logged out' };
  }

  async login(dto: LoginDto, ip?: string) {
    const user = await this.prisma.user.findFirst({
      where: { username: dto.username, deletedAt: null },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      const failCount = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failCount,
          lockedUntil: failCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      await this.prisma.loginHistory.create({ data: { userId: user.id, success: false, ipAddress: ip } });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) throw new UnauthorizedException('Account is inactive');

    // The cost a password was hashed with is baked into the hash, so changing
    // BCRYPT_COST does nothing for an account that already exists. Re-hashing here is
    // what carries the change to existing users, one account at a time, with nobody
    // forced to reset a password. It only runs when the cost actually differs, so it
    // is a single extra hash once per user and nothing at all thereafter.
    const rehash = needsRehash(user.passwordHash)
      ? { passwordHash: await hashPassword(dto.password) }
      : {};

    // These three writes touch different tables and none reads the others' result, so
    // they go out together (WMS-08-002). On production the database is a network hop
    // away, and awaiting them one at a time added two round trips to every login for
    // no reason. Still awaited as a group: a failure must surface, and the audit and
    // login-history rows must exist before the caller is handed a token.
    await Promise.all([
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), ...rehash },
      }),
      this.prisma.loginHistory.create({ data: { userId: user.id, success: true, ipAddress: ip } }),
      this.prisma.auditLog.create({
        data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ipAddress: ip },
      }),
    ]);

    const payload = { sub: user.id, username: user.username, role: user.role };
    // Every token carries a jti so logout / revocation (TokenBlocklist) can target it.
    const accessToken = this.jwt.sign(payload, { jwtid: randomUUID() });
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
      jwtid: randomUUID(),
    });

    return {
      accessToken,
      refreshToken,
      forcePasswordChange: user.forcePasswordChange,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        department: user.department,
      },
    };
  }

  // ── Password policy: >= 8 chars, upper + lower + digit ────────────────────
  private validatePasswordPolicy(pw: string) {
    const errs = passwordPolicyErrors(pw);
    if (errs.length) throw new BadRequestException(`Password must contain: ${errs.join(', ')}`);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    this.validatePasswordPolicy(newPassword);
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must differ from the current password');
    }
    const hash = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, forcePasswordChange: false, passwordChangedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId },
    });
    return { changed: true };
  }

  async register(dto: RegisterDto, actor: GrantActor) {
    // Role assignment is enforced here, not in the UI: only a system
    // administrator may create another SYSTEM_ADMIN.
    assertCanGrantLegacyRole(actor, dto.role);
    dto.department = (await this.masterData.assertDepartment(dto.department)) ?? undefined;
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email ?? undefined }] },
    });
    if (exists) throw new ConflictException('Username or email already exists');

    const hash = await hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        fullName: dto.fullName,
        email: dto.email,
        passwordHash: hash,
        role: dto.role,
        department: dto.department,
      },
      select: { id: true, username: true, fullName: true, email: true, role: true },
    });
    await this.prisma.auditLog.create({
      data: { userId: actor.id, action: 'USER_CREATED', entityType: 'User', entityId: user.id, detail: `${user.username} (${user.role})` },
    });
    return user;
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      if (payload.jti && (await this.blocklist.isRevoked(payload.jti))) throw new Error('revoked');
      // A deactivated or deleted account must not mint new access tokens.
      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null, isActive: true },
        select: { id: true, username: true, role: true },
      });
      if (!user) throw new Error('inactive');
      const newPayload = { sub: user.id, username: user.username, role: user.role };
      return { accessToken: this.jwt.sign(newPayload, { jwtid: randomUUID() }) };
    } catch {
      throw new BadRequestException('Invalid refresh token');
    }
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        role: true,
        department: true,
        phone: true,
        avatarUrl: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }
}
