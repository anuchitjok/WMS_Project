import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await this.prisma.loginHistory.create({ data: { userId: user.id, success: true, ipAddress: ip } });
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ipAddress: ip },
    });

    const payload = { sub: user.id, username: user.username, role: user.role };
    const accessToken = this.jwt.sign(payload);
    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
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
    const errs: string[] = [];
    if (!pw || pw.length < 8) errs.push('at least 8 characters');
    if (!/[A-Z]/.test(pw)) errs.push('one uppercase letter');
    if (!/[a-z]/.test(pw)) errs.push('one lowercase letter');
    if (!/[0-9]/.test(pw)) errs.push('one digit');
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
    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, forcePasswordChange: false, passwordChangedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { userId, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId },
    });
    return { changed: true };
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email ?? undefined }] },
    });
    if (exists) throw new ConflictException('Username or email already exists');

    const hash = await bcrypt.hash(dto.password, 12);
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
    return user;
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
      const newPayload = { sub: payload.sub, username: payload.username, role: payload.role };
      return { accessToken: this.jwt.sign(newPayload) };
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
