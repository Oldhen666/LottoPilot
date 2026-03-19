/**
 * 订阅/权益变更事件：购买成功后通知 Settings 等组件刷新 plan 状态
 */
const listeners: Array<() => void> = [];

export function onPlanUpdated(cb: () => void): () => void {
  listeners.push(cb);
  return () => {
    const i = listeners.indexOf(cb);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function emitPlanUpdated(): void {
  listeners.forEach((cb) => cb());
}
