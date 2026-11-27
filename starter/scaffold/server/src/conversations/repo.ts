import { getStores, isDuplicateKey } from '../pigeon/store.js';

// One atomic conditional upsert on the unique (workspace, contact) index:
//  - no conversation yet      -> inserted, owned by `agent`
//  - unassigned or same agent -> filter matches, assignee set (no-op if same)
//  - owned by someone else    -> filter does not match, so the upsert tries to
//                                insert, hits the unique index (E11000), and
//                                we report "taken".
// There is no read-then-write anywhere, so concurrent claimers cannot both win.
export async function claimConversation(workspace: string, contact: string, agent: string): Promise<boolean> {
  const { contacts } = await getStores();
  // A concurrent first-insert can make even a claimable upsert hit E11000 once;
  // the retry then matches the existing row. A second E11000 means it is owned.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await contacts.updateOne(
        { workspace, contact, $or: [{ assignee: null }, { assignee: agent }] },
        { $set: { assignee: agent }, $setOnInsert: { created_at: new Date() } },
        { upsert: true },
      );
      return true;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }
  return false;
}
