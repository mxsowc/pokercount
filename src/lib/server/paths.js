// Shared data directory for all server stores.
// Uses process.cwd()/data/ which works in both dev and production (adapter-node).
import { join } from 'node:path';

export const DATA_DIR = process.env.PC_DATA_DIR || join(process.cwd(), 'data');
