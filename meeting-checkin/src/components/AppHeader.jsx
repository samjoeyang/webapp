import { useEffect, useRef, useState } from 'react';
import { loginUrl, logoutUrl } from '../../../src/session.js';

/* 内联 SVG 图标（Lucide 风格，避免 emoji 在各平台渲染不一致） */
const Icon = ({ d, size = 18, fill = 'none' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const CalendarCheck = () => <Icon size={19} d={<>
  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
  <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
  <line x1="3" y1="10" x2="21" y2="10" />
  <path d="m9 16 2 2 4-4" />
</>} />;
const ChevronLeft = () => <Icon d={<polyline points="15 18 9 12 15 6" />} />;
const Clipboard = () => <Icon size={16} d={<>
  <rect x="8" y="2" width="8" height="4" rx="1" />
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
  <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" />
</>} />;
const Plus = () => <Icon size={16} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />;
const UserCircle = () => <Icon size={16} d={<>
  <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
</>} />;

/* 登录者头像：有真实图片显示图片，加载失败/无图回退首字母 */
function Avatar({ me }) {
  const [failed, setFailed] = useState(false);
  const url = me?.picture || '';
  const initial = ((me?.name || me?.email || 'U').slice(0, 1).toUpperCase());
  return url && !failed
    ? <img className="ah-avatar ah-avatar-img" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className="ah-avatar">{initial}</span>;
}

/**
 * 统一吸顶导航：向下滚动自动收起，向上滚动 / 回到顶部自动显示。
 * - me：useMe() 的登录态（undefined 探测中 / null 未登录 / object 已登录）
 * - onBack：提供则显示返回箭头，否则显示品牌标识
 * - action：右侧主操作胶囊 { label, onClick | href }（如「我的会议」「创建」）
 */
export default function AppHeader({ me, onBack, action }) {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      const dy = y - lastY.current;
      if (y < 48) setHidden(false);
      else if (dy > 6) setHidden(true);
      else if (dy < -6) setHidden(false);
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const auth = me === undefined
    ? <span className="ah-auth ah-loading" aria-label="检测登录中"><i /><i /><i /></span>
    : me
      ? <span className="ah-auth" title={me.sub || me.email}>
          <Avatar me={me} />
          <span className="ah-name">{me.name || '已登录'}</span>
          <a className="ah-logout" href={logoutUrl(location.href)}>退出</a>
        </span>
      : <a className="ah-auth ah-login" href={loginUrl(location.href)}><UserCircle /> 登录</a>;

  return (
    <header className={'app-header' + (hidden ? ' collapsed' : '')}>
      <div className="ah-inner">
        <div className="ah-left">
          {onBack
            ? <button type="button" className="ah-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft /></button>
            : <span className="ah-brand"><span className="ah-brand-ico"><CalendarCheck /></span>会议签到</span>}
        </div>
        <div className="ah-right">
          {action && (action.href
            ? <a className="ah-pill" href={action.href} onClick={action.onClick}>{action.icon === 'plus' ? <Plus /> : <Clipboard />}<span>{action.label}</span></a>
            : <button type="button" className="ah-pill" onClick={action.onClick}>{action.icon === 'plus' ? <Plus /> : <Clipboard />}<span>{action.label}</span></button>)}
          {auth}
        </div>
      </div>
    </header>
  );
}
