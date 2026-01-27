const storage = require('../../storage');
const pool = require('../../../config/database');

async function processFamilyDeletes(PopulationState) {
    console.log('💾 [3/8] Getting pending family deletes...');
    const pendingFamilyDeletes = await PopulationState.getPendingFamilyDeletes();
    console.log(`💾 [3/8] Found ${pendingFamilyDeletes.length} family deletes`);

    if (pendingFamilyDeletes.length > 0) {
        console.log(`🗑️ Deleting ${pendingFamilyDeletes.length} families from PostgreSQL...`);

        // Remove from fertile family set
        try {
            for (const fid of pendingFamilyDeletes) {
                await storage.srem('eligible:pregnancy:families', fid.toString());
            }
        } catch (_) { }

        // Clear family_id references in people table
        const famPlaceholders = pendingFamilyDeletes.map((_, idx) => `$${idx + 1}`).join(',');
        await pool.query(`UPDATE people SET family_id = NULL WHERE family_id IN (${famPlaceholders})`, pendingFamilyDeletes);

        // Delete the families
        await pool.query(`DELETE FROM family WHERE id IN (${famPlaceholders})`, pendingFamilyDeletes);
    }

    return pendingFamilyDeletes.length;
}

module.exports = { processFamilyDeletes };