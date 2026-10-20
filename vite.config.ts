/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relativa sökvägar så att bygget fungerar både på webben och i Capacitor.
  base: './',
  build: {
    target: ['es2022', 'safari15'],
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
