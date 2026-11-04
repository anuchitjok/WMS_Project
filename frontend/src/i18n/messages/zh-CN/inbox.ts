import type { Messages } from '../en';

export const inbox: Messages['inbox'] = {
  notifications: {
    title: '通知',
    subtitle: '所有系统提醒和流程更新',
    markAll: '全部标为已读',
    allMarked: '已全部标为已读',
    empty: '没有通知',
    clickToOpen: '点击打开 →',
  },
  work: {
    title: '工作队列',
    subtitle: '未完成工作，最早的在前 — 下一步操作、负责人及已等待时长',
    stageLabel: '阶段',
    all: '全部',
    stages: {
      Receive: '收货',
      Putaway: '上架',
      Approve: '审批',
      Allocate: '分配',
      Fulfil: '履约',
      Return: '退货',
      Scrap: '报废',
    },
    col: {
      stage: '阶段',
      reference: '单号',
      what: '内容',
      next: '下一步操作',
      responsible: '负责人',
      waiting: '已等待',
    },
    nothing: '没有待处理的工作。',
    nothingIn: '{stage} 阶段没有待处理的工作。',
    mins: '{n} 分钟',
    hours: '{n} 小时',
    days: '{n} 天',
    loadFailed: '加载工作队列失败',
  },
};
