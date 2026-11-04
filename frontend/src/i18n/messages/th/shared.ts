import type { Messages } from '../en';

export const shared: Messages['shared'] = {
  stockPicker: {
    label: 'หน่วยสต็อก',
    placeholder: 'พิมพ์ซีเรียล รหัสสินค้า หรือชื่อ — หรือสแกนบาร์โค้ด',
    noStock: 'ไม่พบสต็อก',
    searchFailed: 'ค้นหาไม่สำเร็จ',
    noExact: 'ไม่พบบาร์โค้ดที่ตรงกันพอดี — เลือกจากรายการ',
    noStockFor: 'ไม่พบสต็อกสำหรับ {code}',
    change: 'เปลี่ยนหน่วยสต็อก',
    searching: 'กำลังค้นหา…',
    qty: 'จำนวน {qty}',
    notAllowed: ' · ใช้ที่นี่ไม่ได้',
    cantUse: '{name} อยู่ในสถานะ {status} — ใช้ที่นี่ไม่ได้',
  },
  reasonField: {
    label: 'เหตุผล',
    select: 'เลือกเหตุผล…',
  },
};
