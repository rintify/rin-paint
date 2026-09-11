import { createContext, useContext, type ReactNode } from 'react';
import type { PaintEngine } from '../engine/PaintEngine';
import { getEngine } from '../engine/instance';

const EngineContext = createContext<PaintEngine | null>(null);

export function EngineProvider({
  engine,
  children,
}: {
  engine?: PaintEngine;
  children: ReactNode;
}) {
  return (
    <EngineContext.Provider value={engine ?? getEngine()}>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine(): PaintEngine {
  return useContext(EngineContext) ?? getEngine();
}
