import { CanvasView } from './components/CanvasView';
import { EngineProvider } from './components/EngineContext';
import { LeftPanel } from './components/LeftPanel';

export default function App() {
  return (
    <EngineProvider>
      <div className="app">
        <LeftPanel />
        <CanvasView />
      </div>
    </EngineProvider>
  );
}
