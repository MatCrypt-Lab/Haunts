import { describe, expect, it } from 'vitest';
import { createPool } from '../src/db';

describe('db pool', () => {
  it('survives an idle connection error instead of crashing the process', async () => {
    const pool = createPool('postgres://localhost:1/none', false);
    // Without a listener, emitting 'error' throws, which is what killed the API.
    expect(() => pool.emit('error', new Error('read EADDRNOTAVAIL'))).not.toThrow();
    await pool.end();
  });
});
