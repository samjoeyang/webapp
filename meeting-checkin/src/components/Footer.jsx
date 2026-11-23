import { copy, installPrompt } from '../lib/util.js';

/* 页脚：AI 填会技能远程安装提示 + 复制按钮 */
export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="foot-h">🤖 安装 AI 填会技能</div>
      <p>复制下方提示语，粘贴到 WorkBuddy 等智能体对话中，即可从本站远程安装/更新「会议信息」技能。安装后，把会议通知、海报或口述信息发给智能体，它会输出标准格式文本；复制后回到本页任意位置粘贴，即自动填充表单，一键创建会议。</p>
      <button className="btn plain sm" style={{ marginTop: 10 }} onClick={() => copy(installPrompt())}>📋 复制安装 / 更新提示语</button>
      <div className="foot-note">技能文件由本站远程提供（skill/SKILL.md）· 更新时重发一次提示语即可</div>
    </footer>
  );
}
