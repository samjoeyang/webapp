/* 轻量 toast 事件层：视图调用 toast(msg)，由唯一的 <ToastHost/> 订阅并渲染。
   保持与旧版一致的时序（2.2s 自动隐藏），样式复用 styles.css 的 .toast/.show */
let notify = null;

export function toast(msg) {
  if (notify) notify(String(msg ?? ''));
}

export function subscribeToast(fn) {
  notify = fn;
  return () => { if (notify === fn) notify = null; };
}
