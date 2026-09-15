import { useCallback, useState } from 'react';
import { StartupScreen } from './components/StartupScreen';
import { PageView } from './components/PageView';
import { EngineProvider } from './components/EngineContext';
import { LeftPanel } from './components/LeftPanel';
import { ShortcutActions } from './components/ShortcutActions';
import { FileActions } from './components/FileActions';

export default function App() {
  const [startup, setStartup] = useState<'loading' | 'ready' | 'error'>('loading');
  const ready = useCallback(() => setStartup('ready'), []);
  const failed = useCallback(() => setStartup('error'), []);
  const loading = startup !== 'ready';
  return (
    <EngineProvider>
      <div className={`app${loading ? ' app-starting' : ''}`} inert={loading} aria-hidden={loading} aria-busy={loading}>
        <LeftPanel />
        <PageView onReady={ready} onError={failed} />
        {!loading && <><ShortcutActions /><FileActions /></>}
      </div>
      <StartupScreen state={startup} />
    </EngineProvider>
  );
}
