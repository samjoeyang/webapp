import jsQR from 'jsqr';

/* 相机扫码收录：getUserMedia + jsQR 逐帧解码，2.5s 内同码不重复触发。
   返回停止函数（关流、停 rAF）。

   startScan(video, onText, onError)
   - onText(code)：识别到二维码文本
   - onError({ code, title, detail })：相机无法启动时的精确原因，供 UI 展示与重试
*/

function classify(err) {
  const name = (err && err.name) || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'UserMediaPermissionDeniedError':
      return {
        code: 'denied',
        title: '相机权限未允许',
        detail: '请在 iPhone「设置 › Safari 浏览器 › 相机」设为「允许」，或点地址栏左侧的网站图标 → 网站设置 → 相机允许，然后刷新本页。',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        code: 'nodevice',
        title: '未找到可用摄像头',
        detail: '当前设备没有可用摄像头，或后置摄像头参数不被支持。可让参会人在签到页自助签到。',
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        code: 'busy',
        title: '摄像头被占用',
        detail: '摄像头可能正被其他应用使用，关闭后再点「重试」。',
      };
    case 'AbortError':
      return { code: 'abort', title: '相机启动被中断', detail: '请再点一次「重试」。' };
    case 'SecurityError':
      return {
        code: 'insecure',
        title: '浏览器阻止了相机',
        detail: '请确认用 Safari 打开且地址为 https:// 开头；若通过微信/App 内置浏览器打开，请点右上角「在 Safari 中打开」。',
      };
    default:
      return {
        code: 'unknown',
        title: '无法启动相机',
        detail: (err && err.message) ? ('错误信息：' + err.message) : '未获取到摄像头，请检查设备后重试。',
      };
  }
}

function precheck() {
  if (!window.isSecureContext) {
    return {
      code: 'insecure',
      title: '当前页面不是安全环境',
      detail: '相机仅支持 HTTPS 或 localhost 打开。请确认地址栏以 https:// 开头。',
    };
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    return {
      code: 'unsupported',
      title: '当前浏览器不支持相机扫码',
      detail: '请用系统 Safari / Chrome 打开本页；微信或旧版内置浏览器可能不支持。也可让参会人在签到页自助签到。',
    };
  }
  return null;
}

/* 先尝试后置摄像头（ideal 软约束，避免 OverconstrainedError），失败降级到任意可用摄像头。 */
async function openCamera() {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (_) {
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

export function startScan(video, onText, onError) {
  let stream = null, stopFlag = false, lastText = '', lastAt = 0, raf = 0;
  const fail = (info) => { if (!stopFlag && onError) onError(info); };

  const bad = precheck();
  if (bad) {
    fail(bad);
    return () => {};
  }

  // iOS 自动播放要求：静音 + inline，否则 video.play() 可能被拒
  video.muted = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('autoplay', '');

  (async () => {
    let s;
    try {
      s = await openCamera();
    } catch (e) {
      fail(classify(e));
      return;
    }
    if (stopFlag) { s.getTracks().forEach(t => t.stop()); return; }
    stream = s;
    video.srcObject = s;
    try { await video.play(); } catch (_) { /* 部分浏览器仍需用户手势，画面会在下次交互后播放 */ }
    if (onError) onError(null); // 启动成功，清除此前的错误
    tick();
  })();

  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function tick() {
    if (stopFlag) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      cv.width = video.videoWidth;
      cv.height = video.videoHeight;
      cx.drawImage(video, 0, 0);
      const code = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
      const now = Date.now();
      if (code && code.data && !(code.data === lastText && now - lastAt < 2500)) {
        lastText = code.data;
        lastAt = now;
        onText(code.data);
      }
    }
    raf = requestAnimationFrame(tick);
  }
  return () => {
    stopFlag = true;
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
  };
}
