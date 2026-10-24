import {defineConfig} from 'vitest/config';export default defineConfig({test:{setupFiles:['test/setup.ts'],maxWorkers:1,fileParallelism:false}});
