import { pino } from 'pino';
import { env, IS_PROD } from '../env.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (IS_PROD ? 'info' : 'debug'),
  transport: IS_PROD
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } }, // stdout, plain
  base: undefined,
});

void env;
