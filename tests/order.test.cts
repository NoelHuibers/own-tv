import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recentFirst } from '../app/order';

test('Watch follows most recent use without losing stable order for unplayed apps', () => {
  const items = [{ launchId: 'youtube' }, { launchId: 'netflix' }, { launchId: 'spotify' }];
  assert.deepEqual(
    recentFirst(
      items,
      [{ id: 'own-tv' }, { id: 'spotify' }, { id: 'netflix' }, { id: 'spotify' }],
      false,
    ).map((x) => x.launchId),
    ['spotify', 'netflix', 'youtube'],
  );
  assert.deepEqual(recentFirst(items, [], false), items);
  assert.deepEqual(recentFirst(items, [{ id: 'spotify' }], true), items);
  assert.equal(items[0]?.launchId, 'youtube');
});
