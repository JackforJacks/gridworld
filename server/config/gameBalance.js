/**
 * Game Balance Constants
 * 
 * This module centralizes all game balance parameters and magic numbers
 * to make them easier to understand, maintain, and tune.
 */

module.exports = {
    /**
     * CALENDAR AND TIME CONSTANTS
     */
    
    /** Number of days in each month in the game calendar */
    DAYS_PER_MONTH: 8,
    
    /** Number of months in a year in the game calendar */
    MONTHS_PER_YEAR: 12,
    
    /** Total days in a game year (8 days/month * 12 months) */
    DAYS_PER_YEAR: 96,

    /**
     * POPULATION AND LIFECYCLE CONSTANTS
     */
    
    /** Age at which senescence (aging death) begins */
    SENESCENCE_START_AGE: 60,
    
    /** Base annual death probability at senescence start age (1%) */
    BASE_ANNUAL_DEATH_CHANCE: 0.01,
    
    /** Annual death probability increase per year after senescence starts (2% per year) */
    DEATH_CHANCE_INCREASE_PER_YEAR: 0.02,

    /**
     * STATISTICS AND DATA RETENTION CONSTANTS
     */
    
    /** Maximum number of years of vital events to retain in memory */
    VITAL_EVENTS_RETENTION_YEARS: 100,
    
    /** 
     * Maximum number of vital event records to keep in memory
     * Calculated as: years * months (100 years * 12 months = 1200 records)
     */
    VITAL_EVENTS_MAX_RECORDS: 1200,
};
