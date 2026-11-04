import type { Messages } from '../en';

export const setup: Messages['setup'] = {
  title: '设置检查清单',
  subtitle: '已设置的内容、缺少的内容以及修复位置 — 每次都根据实际数据检查',
  checkAgain: '重新检查',
  complete: '设置已完成。',
  readyCount: '{total} 个步骤中已就绪 {ready} 个。',
  nothingLeft: '没有待办事项。',
  open: '打开',
  status: {
    READY: '就绪',
    IN_PROGRESS: '进行中',
    NOT_STARTED: '未开始',
    NEEDS_FIX: '需修复',
    REVIEW: '需复核',
  },
  steps: {
    company: '公司资料',
    codes: '计量单位、部门和原因代码',
    partners: '品牌和供应商',
    warehouse: '仓库结构',
    products: '产品',
    access: '角色、用户和仓库权限',
    approvals: '审批规则',
    settings: '系统设置',
  },
};
