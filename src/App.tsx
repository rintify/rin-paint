import { PageView } from './components/PageView';
import { EngineProvider } from './components/EngineContext';
import { LeftPanel } from './components/LeftPanel';
import { ShortcutActions } from './components/ShortcutActions';
import { FileActions } from './components/FileActions';

export default function App() {
  return (
    <EngineProvider>
      <div className="app">
        <LeftPanel />
        <PageView />
        <ShortcutActions />
        <FileActions />
      </div>
    </EngineProvider>
  );
}
