import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SignaturePad from 'signature_pad';

/* 导航助手：与 react-router HashRouter 配合；
   go('#/m/1') 或 go('/m/1') 均跳转到对应 hash 路由，保持共享链接形态 */
export function useGo() {
  const navigate = useNavigate();
  return (h) => navigate(typeof h === 'string' && h.startsWith('#') ? h.slice(1) : h);
}

export function useBack() {
  const navigate = useNavigate();
  return () => (window.history.length > 1 ? navigate(-1) : navigate('/create'));
}

/* 手写签名板 hook：基于 signature_pad（pointer 事件/压感/retina 适配）。
   窗口尺寸变化时保留笔迹（toData/fromData 重绘）。
   返回 { hasInk, clear, data }：墨迹检测、清空、导出 240px 宽 JPEG。 */
export function useSignaturePad(canvasRef, enabled) {
  const padRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas || padRef.current) return;

    const pad = new SignaturePad(canvas, {
      minWidth: 2,
      maxWidth: 3,
      penColor: '#1c2333',
      backgroundColor: '#fff',
    });
    padRef.current = pad;

    let strokeData = null;
    const resize = () => {
      if (!canvas.offsetWidth || !canvas.offsetHeight) return;
      if (canvas.width) strokeData = pad.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      pad.clear();
      if (strokeData) pad.fromData(strokeData);
    };
    requestAnimationFrame(resize);
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      if (pad.off) pad.off();
      padRef.current = null;
    };
  }, [enabled, canvasRef]);

  return {
    hasInk: () => !!padRef.current && !padRef.current.isEmpty(),
    clear: () => { if (padRef.current) padRef.current.clear(); },
    data: () => {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) return null;
      const src = pad.canvas;
      const W = 240;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Math.round(W * src.offsetHeight / src.offsetWidth);
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff';
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.5);
    },
  };
}
