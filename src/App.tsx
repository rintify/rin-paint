import { CanvasView } from './components/CanvasView';
import { EngineProvider } from './components/EngineContext';
import { LeftPanel } from './components/LeftPanel';
import { ShortcutActions } from './components/ShortcutActions';

export default function App() {
  return (
    <EngineProvider>
      <div className="app">
        <LeftPanel />
        <CanvasView />
        <ShortcutActions />
      </div>
    </EngineProvider>
  );
}
