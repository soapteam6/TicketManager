import { eq } from 'drizzle-orm';
import type { DirectoryUser } from '@ais/shared';
import { db } from '../db/client.js';
import { contacts } from '../db/schema.js';
import { newPublicId } from '../lib/ids.js';

// Read-only external contract: apply a snapshot locally, never write to a directory.
// App isActive is intentionally absent from the update path.
export function syncDirectorySnapshot(entries: DirectoryUser[], now = Date.now()) {
  return db.transaction(() => {
    const previous = db.select().from(contacts).all().filter((c) => c.directoryUserId);
    const ids = new Set(entries.map((e) => e.id));
    for (const prior of previous) {
      if (!ids.has(prior.directoryUserId!)) db.update(contacts).set({ directoryActive: 0, updatedAt: now }).where(eq(contacts.id, prior.id)).run();
    }
    for (const entry of entries) {
      const prior = previous.find((c) => c.directoryUserId === entry.id);
      const source = { fullName: entry.displayName, email: entry.email, title: entry.jobTitle, directoryActive: entry.isActive === false ? 0 : 1, updatedAt: now };
      if (prior) db.update(contacts).set(source).where(eq(contacts.id, prior.id)).run();
      else db.insert(contacts).values({ ...source, publicId: newPublicId(), type: 'employee', company: 'Synthetic Demo', directoryUserId: entry.id, isActive: 1, createdAt: now }).run();
    }
    return { synced: entries.length, provider: 'mock', directoryModified: false };
  });
}
