import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  findAll(filter: { userId?: string; entityType?: string; page?: number; limit?: number }) {
    const { userId, entityType, page = 1, limit = 50 } = filter;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;

    return this.prisma.auditLog.findMany({
      where,
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }
}
