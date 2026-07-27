import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 静的サーバーのルート以外（例: /rin-paint/）へ置いても、
  // index.html から assets を相対参照できるようにする。
  base: './',
});
