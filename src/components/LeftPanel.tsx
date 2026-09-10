import { ColorControls } from './ColorControls';
import { HistoryControls } from './HistoryControls';
import { LayerPanel } from './LayerPanel';
import { MainMenu } from './MainMenu';
import { PenSettings } from './PenSettings';
import { ToolPicker } from './ToolPicker';
import { StorageUsage } from './StorageUsage';
import { useStore } from '../state/store';

function ExportProgress() {
  const progress = useStore((s) => s.exportProgress);
  if (progress === null) return null;
  const pct = Math.round(progress * 100);
  return (
    <div className="header-progress">
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span>タイムラプス書き出し中… {pct}%</span>
    </div>
  );
}

export function LeftPanel() {
  return (
    <aside className="left-panel">
      <header className="panel-header">
        <h1>rin-paint</h1>
        <div className="header-actions">
          <HistoryControls />
          <MainMenu />
        </div>
      </header>
      <ExportProgress />
      <ToolPicker />
      <PenSettings />
      <ColorControls />
      <LayerPanel />
      <StorageUsage />
    </aside>
  );
}
