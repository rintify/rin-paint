import { createContext, useContext, type ReactNode } from 'react';
import type { PaintEngine } from '../engine/PaintEngine';
import { engine as defaultEngine } from '../engine/instance';

const EngineContext = createContext<PaintEngine>(defaultEngine);

export function EngineProvider({
  engine = defaultEngine,
  children,
}: {
  engine?: PaintEngine;
  children: ReactNode;
}) {
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

export function useEngine(): PaintEngine {
  return useContext(EngineContext);
}
