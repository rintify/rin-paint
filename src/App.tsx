import { CanvasView } from './components/CanvasView';
import { LeftPanel } from './components/LeftPanel';

export default function App() {
  return (
    <div className="app">
      <LeftPanel />
      <CanvasView />
    </div>
  );
}
