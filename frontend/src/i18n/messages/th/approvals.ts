import type { Messages } from '../en';

export const approvals: Messages['approvals'] = {
  title: 'พื้นที่อนุมัติ',
  subtitle: 'คิวอนุมัติและตรวจสอบใบขอเบิกทั้งหมด',
  col: {
    request: 'ใบขอเบิก',
    requester: 'ผู้ขอ',
    rma: 'RMA',
    stockCheck: 'ตรวจสต็อก',
    status: 'สถานะ',
    action: 'การดำเนินการ',
  },
  empty: 'ไม่มีใบขอเบิกที่รออนุมัติ',
  stockAvailable: 'มีสต็อกเพียงพอ',
  short: 'ขาด {count} รายการ',
  shortLine: '{name}: ต้องการ {need}, มี {have}',
  approve: 'อนุมัติ',
  reject: 'ไม่อนุมัติ',
  rejectTitle: 'ไม่อนุมัติ {ref}',
  reasonLabel: 'เหตุผลที่ไม่อนุมัติ',
  reasonPlaceholder: 'เช่น สต็อกไม่พอ / ใบขอซ้ำ / เลขอ้างอิง RMA ไม่ถูกต้อง',
  reasonHint: 'ผู้ขอจะเห็นเหตุผลนี้ในใบขอเบิกของตน',
  confirmReject: 'ยืนยันไม่อนุมัติ',
  toast: {
    approved: 'อนุมัติใบขอเบิกแล้ว',
    reasonRequired: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ',
    rejected: 'ไม่อนุมัติใบขอเบิกแล้ว',
  },
};
