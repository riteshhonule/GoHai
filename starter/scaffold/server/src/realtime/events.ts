import { getStores, isDuplicateKey } from '../pigeon/store.js';
import { publishWake } from './notify.js';

async function nextSeq(workspace: string): Promise<number> {
  const { counters } = await getStores();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const doc = await counters.findOneAndUpdate({ _id: workspace }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
      if (doc) return doc.seq;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // two first-time upserts raced: retry
    }
  }
  throw new Error('could not allocate a sequence number');
}

// Record a change for a workspace and wake every instance. Idempotent on
// (workspace, key): reporting the same change twice (a duplicate webhook, a
// retry after a crash) adds nothing. A rare lost race only skips a seq number.
export async function emitEvent(workspace: string, key: string, frame: Record<string, unknown>): Promise<void> {
  const { realtime } = await getStores();
  if (await realtime.findOne({ workspace, key }, { projection: { _id: 1 } })) return;
  const seq = await nextSeq(workspace);
  try {
    await realtime.insertOne({ workspace, seq, key, frame: { seq, ...frame }, created_at: new Date() });
  } catch (err) {
    if (isDuplicateKey(err)) return;
    throw err;
  }
  publishWake(workspace);
}

export async function currentSeq(workspace: string): Promise<number> {
  const { counters } = await getStores();
  return (await counters.findOne({ _id: workspace }))?.seq ?? 0;
}

export async function eventsAfter(workspace: string, after: number, limit: number): Promise<Array<{ seq: number; frame: Record<string, unknown> }>> {
  const { realtime } = await getStores();
  const rows = await realtime.find({ workspace, seq: { $gt: after } }).sort({ seq: 1 }).limit(limit).toArray();
  return rows.map((r) => ({ seq: r.seq, frame: r.frame }));
}
