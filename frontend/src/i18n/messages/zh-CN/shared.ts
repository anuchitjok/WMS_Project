import type { Messages } from '../en';

export const shared: Messages['shared'] = {
  stockPicker: {
    label: '库存单元',
    placeholder: '输入序列号、产品编码或名称 — 或扫描条码',
    noStock: '未找到库存',
    searchFailed: '搜索失败',
    noExact: '没有完全匹配的条码 — 请从列表中选择',
    noStockFor: '未找到 {code} 的库存',
    change: '更换库存单元',
    searching: '搜索中…',
    qty: '数量 {qty}',
    notAllowed: ' · 此处不可用',
    cantUse: '{name} 的状态为 {status} — 此处不可用',
  },
  reasonField: {
    label: '原因',
    select: '选择原因…',
  },
  // PR6: pick-list line whose location the approver chose (Manual Pick)
  selectedByApprover: {
    label: '审批人指定',
    title: '审批人在批准时指定了此库存库位（手动拣货）。请严格从此库位拣取。',
  },
};
