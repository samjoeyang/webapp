import { HashRouter, Routes, Route } from 'react-router-dom';
import CreateView from './views/CreateView.jsx';
import HomeView from './views/HomeView.jsx';
import SignView from './views/SignView.jsx';
import MineView from './views/MineView.jsx';
import ToastHost from './components/ToastHost.jsx';

/* 路由映射（与原有 location.hash 路由一致，保留外部分享的 #/s/<mid> 链接形态）：
   #/create 创建会议 · #/m/:mid 会议主页 · #/s/:mid 签到页 · #/mine 我的会议 */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/create" element={<CreateView />} />
        <Route path="/m/:mid" element={<HomeView />} />
        <Route path="/s/:mid" element={<SignView />} />
        <Route path="/mine" element={<MineView />} />
        <Route path="*" element={<CreateView />} />
      </Routes>
      <ToastHost />
    </HashRouter>
  );
}
