import type { Messages } from '../en';

export const approvals: Messages['approvals'] = {
  title: '审批工作台',
  subtitle: '全局申请审批与校验队列',
  col: {
    request: '申请',
    requester: '申请人',
    rma: 'RMA',
    stockCheck: '库存检查',
    status: '状态',
    action: '操作',
  },
  empty: '没有待审批的申请',
  stockAvailable: '库存充足',
  short: '缺 {count} 项',
  shortLine: '{name}：需要 {need}，现有 {have}',
  approve: '批准',
  reject: '驳回',
  rejectTitle: '驳回 {ref}',
  reasonLabel: '驳回原因',
  reasonPlaceholder: '例如：库存不足 / 重复申请 / RMA 参考号错误',
  reasonHint: '申请人将在其申请中看到此原因。',
  confirmReject: '确认驳回',
  toast: {
    approved: '申请已批准',
    reasonRequired: '请填写驳回原因',
    rejected: '申请已驳回',
  },
};
