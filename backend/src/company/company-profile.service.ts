import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { CompanyProfile } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS, AccessPrincipal, hasAccess } from '../auth/access';
import { inspectLogo } from './logo-image';
import { UpdateCompanyProfileDto } from './company-profile.dto';

const ID = 'default';
const TEXT_FIELDS = [
  'legalName', 'displayName', 'address', 'phone', 'email', 'website', 'taxId', 'defaultTerms',
] as const;

/** Customer-safe company identity used on proposals. */
export interface CompanyIdentity {
  name: string | null;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxId: string | null;
  hasLogo: boolean;
}

/**
 * The WMS owner's own company profile (name, contact details, official logo).
 * Stored in the database — no external file storage. Nothing is seeded: until an
 * administrator fills it in, documents show no company identity.
 */
@Injectable()
export class CompanyProfileService {
  constructor(private prisma: PrismaService) {}

  private row() {
    return this.prisma.companyProfile.findUnique({ where: { id: ID } });
  }

  private view(r: CompanyProfile | null, u?: AccessPrincipal) {
    return {
      legalName: r?.legalName ?? null,
      displayName: r?.displayName ?? null,
      address: r?.address ?? null,
      phone: r?.phone ?? null,
      email: r?.email ?? null,
      website: r?.website ?? null,
      taxId: r?.taxId ?? null,
      defaultTerms: r?.defaultTerms ?? null,
      hasLogo: !!r?.logo,
      logoMime: r?.logo ? r.logoMime : null,
      logoWidth: r?.logo ? r.logoWidth : null,
      logoHeight: r?.logo ? r.logoHeight : null,
      logoUpdatedAt: r?.logo ? r.logoUpdatedAt : null,
      configured: !!r?.legalName,
      updatedAt: r?.updatedAt ?? null,
      version: r?.version ?? 0,
      ...(u ? { canEdit: hasAccess(u, ACCESS.settings) } : {}),
    };
  }

  private audit(userId: string, action: string, detail: string) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'CompanyProfile', entityId: ID, detail },
    });
  }

  async get(u: AccessPrincipal) {
    return this.view(await this.row(), u);
  }

  /** Identity for customer documents; null when no company name is set. */
  async identity(): Promise<CompanyIdentity | null> {
    const r = await this.row();
    if (!r?.legalName) return null;
    return {
      name: r.displayName || r.legalName,
      legalName: r.legalName,
      address: r.address,
      phone: r.phone,
      email: r.email,
      website: r.website,
      taxId: r.taxId,
      hasLogo: !!r.logo,
    };
  }

  async defaultTerms(): Promise<string | null> {
    return (await this.row())?.defaultTerms ?? null;
  }

  async logo() {
    const r = await this.prisma.companyProfile.findUnique({
      where: { id: ID },
      select: { logo: true, logoMime: true, logoWidth: true, logoHeight: true, logoUpdatedAt: true },
    });
    if (!r?.logo || !r.logoMime) return { dataUrl: null };
    return {
      dataUrl: `data:${r.logoMime};base64,${Buffer.from(r.logo).toString('base64')}`,
      width: r.logoWidth,
      height: r.logoHeight,
      updatedAt: r.logoUpdatedAt,
    };
  }

  private async check(version: number | undefined) {
    const r = await this.row();
    if (r && version !== undefined && version !== r.version)
      throw new ConflictException(
        'The company profile was changed by someone else — reload and try again',
      );
    return r;
  }

  async update(dto: UpdateCompanyProfileDto, u: AccessPrincipal & { id: string }) {
    const old = await this.check(dto.version);
    const data: Record<string, string | null> = {};
    for (const k of TEXT_FIELDS)
      if (dto[k] !== undefined) data[k] = dto[k]!.trim() || null;
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
      throw new BadRequestException('Enter a valid e-mail address');
    if (data.website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(data.website))
      throw new BadRequestException('Enter a valid website address');
    const changed = Object.keys(data).filter(
      (k) => (old?.[k as keyof CompanyProfile] ?? null) !== data[k],
    );
    const r = await this.prisma.companyProfile.upsert({
      where: { id: ID },
      create: { id: ID, ...data, updatedById: u.id },
      update: { ...data, updatedById: u.id, version: { increment: 1 } },
    });
    if (changed.length)
      await this.audit(u.id, 'COMPANY_PROFILE_UPDATE', `Changed: ${changed.join(', ')}`);
    return this.view(r, u);
  }

  async setLogo(file: Express.Multer.File | undefined, version: number | undefined, u: AccessPrincipal & { id: string }) {
    if (!file?.buffer) throw new BadRequestException('Choose an image file to upload');
    const info = inspectLogo(file.buffer);
    if ('error' in info) throw new BadRequestException(info.error);
    const old = await this.check(version);
    const data = {
      logo: new Uint8Array(file.buffer),
      logoMime: info.mime,
      logoWidth: info.width,
      logoHeight: info.height,
      logoUpdatedAt: new Date(),
      updatedById: u.id,
    };
    const r = await this.prisma.companyProfile.upsert({
      where: { id: ID },
      create: { id: ID, ...data },
      update: { ...data, version: { increment: 1 } },
    });
    await this.audit(
      u.id,
      old?.logo ? 'COMPANY_LOGO_REPLACE' : 'COMPANY_LOGO_UPLOAD',
      `${info.mime} ${info.width} × ${info.height} px, ${Math.round(file.buffer.length / 1024)} KB`,
    );
    return this.view(r, u);
  }

  async removeLogo(version: number | undefined, u: AccessPrincipal & { id: string }) {
    const old = await this.check(version);
    if (!old?.logo) return this.view(old, u);
    const r = await this.prisma.companyProfile.update({
      where: { id: ID },
      data: {
        logo: null, logoMime: null, logoWidth: null, logoHeight: null, logoUpdatedAt: null,
        updatedById: u.id, version: { increment: 1 },
      },
    });
    await this.audit(u.id, 'COMPANY_LOGO_REMOVE', 'Official logo removed');
    return this.view(r, u);
  }
}
