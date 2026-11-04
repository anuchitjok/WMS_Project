import type { Messages } from '../en';

export const setup: Messages['setup'] = {
  title: 'รายการตรวจสอบการตั้งค่า',
  subtitle: 'สิ่งที่ตั้งค่าแล้ว สิ่งที่ยังขาด และที่ที่ต้องแก้ไข — ตรวจจากข้อมูลจริงทุกครั้ง',
  checkAgain: 'ตรวจอีกครั้ง',
  complete: 'ตั้งค่าครบถ้วนแล้ว',
  readyCount: 'พร้อมแล้ว {ready} จาก {total} ขั้นตอน',
  nothingLeft: 'ไม่มีสิ่งที่ต้องทำเพิ่ม',
  open: 'เปิด',
  status: {
    READY: 'พร้อม',
    IN_PROGRESS: 'กำลังดำเนินการ',
    NOT_STARTED: 'ยังไม่เริ่ม',
    NEEDS_FIX: 'ต้องแก้ไข',
    REVIEW: 'ควรตรวจสอบ',
  },
  steps: {
    company: 'ข้อมูลบริษัท',
    codes: 'หน่วยนับ แผนก และรหัสเหตุผล',
    partners: 'แบรนด์และผู้ขาย',
    warehouse: 'โครงสร้างคลังสินค้า',
    products: 'สินค้า',
    access: 'บทบาท ผู้ใช้ และสิทธิ์เข้าถึงคลัง',
    approvals: 'กฎการอนุมัติ',
    settings: 'การตั้งค่าระบบ',
  },
};
