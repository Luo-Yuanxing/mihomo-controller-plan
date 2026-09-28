/**
 * 三页外壳：规则 / 状态 / 设置。
 * 计划 §8 界面。
 */
import { useState } from 'react';
import RulesPage from './pages/RulesPage';
import SettingsPage from './pages/SettingsPage';
import StatusPage from './pages/StatusPage';

const TABS = [
  { key: 'rules', label: '规则', render: () => <RulesPage /> },
  { key: 'status', label: '状态', render: () => <StatusPage /> },
  { key: 'settings', label: '设置', render: () => <SettingsPage /> },
] as const;

export default function App() {
  const [active, setActive] = useState<string>('rules');
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];

  return (
    <div className="flex h-screen flex-col">
      <nav className="flex gap-2 border-b p-2">
        {TABS.map((tab) => (
          <button key={tab.key} type="button" onClick={() => setActive(tab.key)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto p-4">{current.render()}</main>
    </div>
  );
}
