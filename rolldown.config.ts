import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/index.ts',
  platform: 'browser',
  transform: { target: 'es2015' },
  output: {
    dir: 'dist',
    cleanDir: true,
  },
});
