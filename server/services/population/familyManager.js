// Family Management - Handles family creation, pregnancy, and child management
const { calculateAge } = require('./calculator.js');

/**
 * Creates a new family unit
 * @param {Pool} pool - Database pool instance
 * @param {number} husbandId - ID of the husband
 * @param {number} wifeId - ID of the wife
 * @param {number} tileId - Tile ID where the family resides
 * @returns {Object} Created family record
 */
async function createFamily(pool, husbandId, wifeId, tileId) {
    try {
        // Verify both people exist and are of appropriate age/sex
        const peopleResult = await pool.query(
            'SELECT id, sex, date_of_birth FROM people WHERE id IN ($1, $2)',
            [husbandId, wifeId]
        );

        if (peopleResult.rows.length !== 2) {
            throw new Error('Both husband and wife must exist');
        }

        const husband = peopleResult.rows.find(p => p.sex === true);
        const wife = peopleResult.rows.find(p => p.sex === false);

        if (!husband || !wife) {
            throw new Error('Husband must be male and wife must be female');
        }        // Create family record
        const result = await pool.query(`
            INSERT INTO family (husband_id, wife_id, tile_id, pregnancy, children_ids)
            VALUES ($1, $2, $3, FALSE, '{}')
            RETURNING *
        `, [husbandId, wifeId, tileId]);

        const familyId = result.rows[0].id;

        // Update both people to link them to their new family
        await pool.query(`
            UPDATE people 
            SET family_id = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id IN ($2, $3)
        `, [familyId, husbandId, wifeId]);

        console.log(`👨‍👩‍👦 New family created: ID ${familyId} on tile ${tileId}`);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating family:', error);
        throw error;
    }
}

/**
 * Starts pregnancy for a family
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Updated family record
 */
async function startPregnancy(pool, calendarService, familyId) {
    try {
        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        // Calculate delivery date (approximately 9 months later)
        const deliveryYear = currentDate.year;
        const deliveryMonth = currentDate.month + 9;
        const deliveryDay = currentDate.day;

        // Adjust for month overflow
        let finalMonth = deliveryMonth;
        let finalYear = deliveryYear;
        if (deliveryMonth > 12) {
            finalMonth = deliveryMonth - 12;
            finalYear = deliveryYear + 1;
        }

        const deliveryDate = `${finalYear}-${String(finalMonth).padStart(2, '0')}-${String(deliveryDay).padStart(2, '0')}`;

        const result = await pool.query(`
            UPDATE family 
            SET pregnancy = TRUE, delivery_date = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND pregnancy = FALSE
            RETURNING *
        `, [deliveryDate, familyId]);

        if (result.rows.length === 0) {
            throw new Error('Family not found or already pregnant');
        }

        console.log(`🤰 Pregnancy started for family ${familyId}, delivery expected: ${deliveryDate}`);
        return result.rows[0];
    } catch (error) {
        console.error('Error starting pregnancy:', error);
        throw error;
    }
}

/**
 * Delivers a baby and adds to family
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @param {number} familyId - Family ID
 * @returns {Object} Result with baby and updated family
 */
async function deliverBaby(pool, calendarService, populationServiceInstance, familyId) {
    try {
        // Get family record
        const familyResult = await pool.query('SELECT * FROM family WHERE id = $1', [familyId]);
        if (familyResult.rows.length === 0) {
            throw new Error('Family not found');
        }

        const family = familyResult.rows[0];
        if (!family.pregnancy) {
            throw new Error('Family is not currently pregnant');
        }

        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year: currentYear, month: currentMonth, day: currentDay } = currentDate;
        const birthDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;        // Create baby
        const { getRandomSex } = require('./calculator.js');
        const babySex = getRandomSex();

        const babyResult = await pool.query(`
            INSERT INTO people (tile_id, sex, date_of_birth, residency, family_id)
            VALUES ($1, $2, $3, 0, $4)
            RETURNING id
        `, [family.tile_id, babySex, birthDate, familyId]);

        const babyId = babyResult.rows[0].id;

        // Update family record
        const updatedChildrenIds = [...family.children_ids, babyId];
        const updatedFamilyResult = await pool.query(`
            UPDATE family 
            SET pregnancy = FALSE, 
                delivery_date = NULL, 
                children_ids = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
        `, [updatedChildrenIds, familyId]);

        // Track birth
        if (populationServiceInstance && typeof populationServiceInstance.trackBirths === 'function') {
            populationServiceInstance.trackBirths(1);
        }

        console.log(`👶 Baby born! Family ${familyId}, Baby ID: ${babyId}, Sex: ${babySex ? 'Male' : 'Female'}`);

        return {
            baby: { id: babyId, sex: babySex, birthDate },
            family: updatedFamilyResult.rows[0]
        };
    } catch (error) {
        console.error('Error delivering baby:', error);
        throw error;
    }
}

/**
 * Gets all families on a specific tile
 * @param {Pool} pool - Database pool instance
 * @param {number} tileId - Tile ID
 * @returns {Array} Array of family records
 */
async function getFamiliesOnTile(pool, tileId) {
    try {
        const result = await pool.query(`
            SELECT f.*, 
                   h.sex as husband_sex, h.date_of_birth as husband_birth,
                   w.sex as wife_sex, w.date_of_birth as wife_birth
            FROM family f
            LEFT JOIN people h ON f.husband_id = h.id
            LEFT JOIN people w ON f.wife_id = w.id
            WHERE f.tile_id = $1
        `, [tileId]);

        return result.rows;
    } catch (error) {
        console.error('Error getting families on tile:', error);
        return [];
    }
}

/**
 * Checks for families ready to deliver and processes births
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @param {PopulationService} populationServiceInstance - Population service instance
 * @returns {number} Number of babies born
 */
async function processDeliveries(pool, calendarService, populationServiceInstance) {
    try {
        // Get current calendar date
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;
        const currentDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Find families ready to deliver
        const readyFamilies = await pool.query(`
            SELECT id FROM family 
            WHERE pregnancy = TRUE 
            AND delivery_date <= $1
        `, [currentDateStr]);

        let babiesDelivered = 0;
        for (const family of readyFamilies.rows) {
            try {
                await deliverBaby(pool, calendarService, populationServiceInstance, family.id);
                babiesDelivered++;
            } catch (error) {
                console.error(`Error delivering baby for family ${family.id}:`, error);
            }
        }

        if (babiesDelivered > 0) {
            console.log(`👶 ${babiesDelivered} babies delivered today!`);
        }

        return babiesDelivered;
    } catch (error) {
        console.error('Error processing deliveries:', error);
        return 0;
    }
}

/**
 * Gets family statistics
 * @param {Pool} pool - Database pool instance
 * @returns {Object} Family statistics
 */
async function getFamilyStats(pool) {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_families,
                COUNT(*) FILTER (WHERE pregnancy = TRUE) as pregnant_families,
                AVG(array_length(children_ids, 1)) as avg_children_per_family
            FROM family
        `);

        const stats = result.rows[0];
        return {
            totalFamilies: parseInt(stats.total_families, 10) || 0,
            pregnantFamilies: parseInt(stats.pregnant_families, 10) || 0,
            avgChildrenPerFamily: parseFloat(stats.avg_children_per_family) || 0
        };
    } catch (error) {
        console.error('Error getting family stats:', error);
        return {
            totalFamilies: 0,
            pregnantFamilies: 0,
            avgChildrenPerFamily: 0
        };
    }
}

/**
 * Forms new families from eligible bachelors
 * @param {Pool} pool - Database pool instance
 * @param {Object} calendarService - Calendar service instance
 * @returns {number} Number of new families formed
 */
async function formNewFamilies(pool, calendarService) {
    try {
        // Get current calendar date for age calculations
        let currentDate = { year: 1, month: 1, day: 1 };
        if (calendarService && typeof calendarService.getCurrentDate === 'function') {
            currentDate = calendarService.getCurrentDate();
        }

        const { year, month, day } = currentDate;
        // Calculate birth year ranges for eligible bachelors
        // Males aged 16-45: born (currentYear - 45) to (currentYear - 16) years ago
        const maleMinBirthYear = year - 45;
        const maleMaxBirthYear = year - 16;
        // Females aged 16-30: born (currentYear - 30) to (currentYear - 16) years ago
        const femaleMinBirthYear = year - 30;
        const femaleMaxBirthYear = year - 16;
        // Format dates properly
        const maleMinBirthDate = `${maleMinBirthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const maleMaxBirthDate = `${maleMaxBirthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const femaleMinBirthDate = `${femaleMinBirthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const femaleMaxBirthDate = `${femaleMaxBirthYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        console.log(`🔍 Looking for eligible bachelors... Current year: ${year}`);
        console.log(`   Males: birth years ${maleMinBirthYear} to ${maleMaxBirthYear}`);
        console.log(`   Females: birth years ${femaleMinBirthYear} to ${femaleMaxBirthYear}`);

        // Get eligible male bachelors (age 16-45, not in a family)
        const malesResult = await pool.query(`
            SELECT id, tile_id, date_of_birth 
            FROM people 
            WHERE sex = true 
            AND family_id IS NULL 
            AND date_of_birth >= $1 
            AND date_of_birth <= $2
            ORDER BY RANDOM()
        `, [maleMinBirthDate, maleMaxBirthDate]);

        // Get eligible female bachelors (age 16-30, not in a family)
        const femalesResult = await pool.query(`
            SELECT id, tile_id, date_of_birth 
            FROM people 
            WHERE sex = false 
            AND family_id IS NULL 
            AND date_of_birth >= $1 
            AND date_of_birth <= $2
            ORDER BY RANDOM()
        `, [femaleMinBirthDate, femaleMaxBirthDate]);

        const eligibleMales = malesResult.rows;
        const eligibleFemales = femalesResult.rows;

        console.log(`   Found ${eligibleMales.length} eligible males and ${eligibleFemales.length} eligible females`);

        if (eligibleMales.length === 0 || eligibleFemales.length === 0) {
            console.log(`   ❌ No eligible bachelors to form families`);
            return 0;
        }        // Group people by tile to only allow same-tile marriages
        const malesByTile = {};
        const femalesByTile = {};

        eligibleMales.forEach(male => {
            if (!malesByTile[male.tile_id]) malesByTile[male.tile_id] = [];
            malesByTile[male.tile_id].push(male);
        });

        eligibleFemales.forEach(female => {
            if (!femalesByTile[female.tile_id]) femalesByTile[female.tile_id] = [];
            femalesByTile[female.tile_id].push(female);
        });

        let newFamiliesCount = 0;
        const usedMales = new Set();
        const usedFemales = new Set();

        // Only same-tile marriages: match people from the same tile only
        for (const tileId of Object.keys(malesByTile)) {
            const tiledMales = malesByTile[tileId];
            const tiledFemales = femalesByTile[tileId] || [];

            if (tiledFemales.length === 0) {
                console.log(`   Tile ${tileId}: ${tiledMales.length} eligible males but no eligible females`);
                continue;
            }

            const pairs = Math.min(tiledMales.length, tiledFemales.length);
            console.log(`   Tile ${tileId}: Forming ${pairs} families from ${tiledMales.length} males and ${tiledFemales.length} females`);
            
            for (let i = 0; i < pairs; i++) {
                const male = tiledMales[i];
                const female = tiledFemales[i];

                if (!usedMales.has(male.id) && !usedFemales.has(female.id)) {
                    try {
                        await createFamily(pool, male.id, female.id, tileId);
                        usedMales.add(male.id);
                        usedFemales.add(female.id);
                        newFamiliesCount++;

                        // Small chance to start immediate pregnancy (10%)
                        if (Math.random() < 0.1) {
                            const familyResult = await pool.query(
                                'SELECT id FROM family WHERE husband_id = $1 AND wife_id = $2',
                                [male.id, female.id]
                            );
                            if (familyResult.rows.length > 0) {
                                await startPregnancy(pool, calendarService, familyResult.rows[0].id);
                            }
                        }
                    } catch (error) {
                        console.error(`Error creating family between ${male.id} and ${female.id} on tile ${tileId}:`, error);
                    }
                }
            }
        }

        // Report any remaining singles who couldn't find partners on their tile
        const remainingMales = eligibleMales.filter(m => !usedMales.has(m.id));
        const remainingFemales = eligibleFemales.filter(f => !usedFemales.has(f.id));
        
        if (remainingMales.length > 0 || remainingFemales.length > 0) {
            console.log(`   ⚠️  ${remainingMales.length} males and ${remainingFemales.length} females remain single (no eligible partners on their tile)`);
        }

        if (newFamiliesCount > 0) {
            console.log(`💒 Formed ${newFamiliesCount} new families (same-tile marriages only)`);
        }

        return newFamiliesCount;
    } catch (error) {
        console.error('Error forming new families:', error);
        return 0;
    }
}

module.exports = {
    createFamily,
    startPregnancy,
    deliverBaby,
    getFamiliesOnTile,
    processDeliveries,
    getFamilyStats,
    formNewFamilies
};
