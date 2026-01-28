const storage = require('../../storage');
const PopulationState = require('../../populationState');
const { verifyAndRepairIntegrity } = require('../integrity');

describe('verifyAndRepairIntegrity', () => {
    const tileId = 475;

    beforeEach(async () => {
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
        // Add persons: id '1' exists, id '2' exists, id 'missing' does not
        await PopulationState.addPerson({ id: '1', tile_id: tileId, residency: 0 }, true);
        await PopulationState.addPerson({ id: '2', tile_id: tileId, residency: 1 }, true);
        // Create memberships: duplicate for id=1 across residencies 0 and 1
        await storage.sadd(`village:${tileId}:0:people`, '1');
        await storage.sadd(`village:${tileId}:1:people`, '1');
        // Valid membership for id=2
        await storage.sadd(`village:${tileId}:1:people`, '2');
        // Membership referencing missing person id=9999
        await storage.sadd(`village:${tileId}:2:people`, '9999');
    });

    afterAll(async () => {
        const keys = await storage.keys('*');
        if (keys && keys.length > 0) await storage.del(...keys);
        const adapter = storage.getAdapter && storage.getAdapter();
        if (adapter && adapter.client) {
            if (typeof adapter.client.quit === 'function') {
                try { await adapter.client.quit(); } catch (_) { }
            }
            if (typeof adapter.client.disconnect === 'function') {
                try { adapter.client.disconnect(); } catch (_) { }
            }
            if (typeof adapter.client.end === 'function') {
                try { adapter.client.end(); } catch (_) { }
            }
        }
    });

    test('detects duplicates and missing records (dry-run)', async () => {
        const res = await verifyAndRepairIntegrity(null, [tileId], {}, { repair: false });
        expect(res.ok).toBe(false);
        expect(Array.isArray(res.details)).toBe(true);
        const detail = res.details.find(d => d.tileId === tileId);
        expect(detail).toBeTruthy();
        expect(detail.duplicatesCount).toBeGreaterThan(0);
        expect(detail.missingCount).toBeGreaterThan(0);
    });

    test('repairs issues when repair=true', async () => {
        const beforeDupes = await storage.smembers(`village:${tileId}:0:people`);
        expect(beforeDupes).toContain('1');
        const res = await verifyAndRepairIntegrity(null, [tileId], {}, { repair: true });
        expect(res.ok).toBe(true);

        // After repair, missing membership removed
        const afterMissing = await storage.smembers(`village:${tileId}:2:people`);
        expect(afterMissing).not.toContain('9999');

        // Duplicate resolved: id '1' should only be in one set
        const sets = [0, 1].map(r => `village:${tileId}:${r}:people`);
        let total = 0;
        for (const s of sets) {
            const members = await storage.smembers(s);
            if (members.includes('1')) total++;
        }
        expect(total).toBeLessThanOrEqual(1);
    });
});