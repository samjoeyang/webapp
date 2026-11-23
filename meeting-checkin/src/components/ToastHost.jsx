import { useEffect, useRef, useState } from 'react';
import { subscribeToast } from '../lib/toast.js';

/* 全局 toast 渲染组件：挂在 App 根部，替代旧版直接操作 DOM 的 toast() */
export default function ToastHost() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const tmRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeToast((m) => {
      setMsg(m);
      setShow(true);
      clearTimeout(tmRef.current);
      tmRef.current = setTimeout(() => setShow(false), 2200);
    });
    return () => { unsub(); clearTimeout(tmRef.current); };
  }, []);

  return <div id="toast" className={show ? 'toast show' : 'toast'}>{msg}</div>;
}
