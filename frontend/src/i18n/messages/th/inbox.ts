import type { Messages } from '../en';

export const inbox: Messages['inbox'] = {
  notifications: {
    title: 'การแจ้งเตือน',
    subtitle: 'การแจ้งเตือนของระบบและความคืบหน้าของงานทั้งหมด',
    markAll: 'ทำเครื่องหมายว่าอ่านทั้งหมด',
    allMarked: 'ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว',
    empty: 'ไม่มีการแจ้งเตือน',
    clickToOpen: 'คลิกเพื่อเปิด →',
  },
  work: {
    title: 'คิวงาน',
    subtitle: 'งานค้าง เรียงจากเก่าสุด — ขั้นตอนถัดไป ผู้รับผิดชอบ และระยะเวลาที่รอ',
    stageLabel: 'ขั้นตอน',
    all: 'ทั้งหมด',
    stages: {
      Receive: 'รับสินค้า',
      Putaway: 'จัดเก็บ',
      Approve: 'อนุมัติ',
      Allocate: 'จัดสรร',
      Fulfil: 'จัดเตรียม',
      Return: 'รับคืน',
      Scrap: 'ของเสีย',
    },
    col: {
      stage: 'ขั้นตอน',
      reference: 'เลขอ้างอิง',
      what: 'รายการ',
      next: 'ขั้นตอนถัดไป',
      responsible: 'ผู้รับผิดชอบ',
      waiting: 'รอมาแล้ว',
    },
    nothing: 'ไม่มีงานรอ',
    nothingIn: 'ไม่มีงานรอในขั้นตอน{stage}',
    mins: '{n} นาที',
    hours: '{n} ชม.',
    days: '{n} วัน',
    loadFailed: 'โหลดคิวงานไม่สำเร็จ',
  },
};
