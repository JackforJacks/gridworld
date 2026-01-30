// Population Statistics API Routes
const express = require('express');
const router = express.Router();
const StateManager = require('../services/stateManager');

// GET /api/statistics/current - Combined current stats endpoint (summary + today)
// This reduces multiple API calls to a single call for the dashboard
router.get('/current', async (req, res) => {
    try {
        const populationService = req.app.locals.populationService;
        const calendarService = req.app.locals.calendarService;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        // Get current population count from StateManager
        let currentPopulation = 0;
        try {
            const people = await StateManager.getAllPeople();
            currentPopulation = people.length;
        } catch (e) {
            console.warn('Could not get population count:', e.message);
        }

        // Get calendar date
        let currentYear = 4000;
        if (calendarService) {
            const calState = calendarService.getState();
            currentYear = calState?.currentDate?.year || 4000;
        }

        // Get summary stats from the service
        const serviceStats = statisticsService.getSummaryStats ? statisticsService.getSummaryStats() : {};

        // Get current year's events from vitalEvents
        const currentYearEvents = statisticsService.vitalEvents 
            ? statisticsService.vitalEvents.filter(e => e.year === currentYear)
            : [];
        
        const currentYearBirths = currentYearEvents.reduce((sum, e) => sum + (e.births || 0), 0);
        const currentYearDeaths = currentYearEvents.reduce((sum, e) => sum + (e.deaths || 0), 0);

        // Calculate historical averages
        const allYears = statisticsService.vitalEvents 
            ? [...new Set(statisticsService.vitalEvents.map(e => e.year))]
            : [];
        const totalYears = allYears.length;
        
        let avgBirthRate = 0;
        let avgDeathRate = 0;
        
        if (totalYears > 0 && statisticsService.vitalEvents) {
            const totalBirths = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.births || 0), 0);
            const totalDeaths = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.deaths || 0), 0);
            const avgPopulation = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.population || 0), 0) / statisticsService.vitalEvents.length;
            
            if (avgPopulation > 0) {
                avgBirthRate = ((totalBirths / totalYears) / avgPopulation * 1000).toFixed(2);
                avgDeathRate = ((totalDeaths / totalYears) / avgPopulation * 1000).toFixed(2);
            }
        }

        // Get today's events from the event log
        const eventLog = populationService.eventLog || [];
        const todayBirths = eventLog.filter(e => e.type === 'birth').length;
        const todayDeaths = eventLog.filter(e => e.type === 'death').length;
        const todayFamiliesFormed = eventLog.filter(e => e.type === 'family_formed').length;
        const todayPregnanciesStarted = eventLog.filter(e => e.type === 'pregnancy_started').length;

        res.json({
            success: true,
            summary: {
                currentPopulation,
                currentYear,
                currentYearBirths,
                currentYearDeaths,
                totalYears,
                avgBirthRate,
                avgDeathRate,
                ...serviceStats
            },
            today: {
                births: todayBirths,
                deaths: todayDeaths,
                familiesFormed: todayFamiliesFormed,
                pregnanciesStarted: todayPregnanciesStarted
            }
        });
    } catch (error) {
        console.error('Error getting current statistics:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get vital rates for charting (with optional years parameter)
router.get('/vital-rates/:years', async (req, res) => {
    try {
        const years = parseInt(req.params.years) || 100;
        const populationService = req.app.locals.populationService;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        const chartData = statisticsService.getVitalRatesForChart(years);
        const summary = statisticsService.getSummaryStats();

        res.json({
            success: true,
            data: chartData,
            summary: summary,
            requestedYears: years
        });
    } catch (error) {
        console.error('Error getting vital rates:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get vital rates for charting (default 100 years)
router.get('/vital-rates', async (req, res) => {
    try {
        const years = 100;
        const populationService = req.app.locals.populationService;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        const chartData = statisticsService.getVitalRatesForChart(years);
        const summary = statisticsService.getSummaryStats();

        res.json({
            success: true,
            data: chartData,
            summary: summary,
            requestedYears: years
        });
    } catch (error) {
        console.error('Error getting vital rates:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get summary statistics endpoint
router.get('/summary', async (req, res) => {
    try {
        const populationService = req.app.locals.populationService;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        const summary = statisticsService.getSummaryStats();

        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error('Error getting summary statistics:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check for statistics service
router.get('/health', async (req, res) => {
    try {
        const populationService = req.app.locals.populationService;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        const summary = statisticsService.getSummaryStats();

        res.json({
            success: true,
            message: 'Statistics service is healthy',
            totalYears: summary.totalYears,
            totalEvents: summary.totalBirths + summary.totalDeaths
        });
    } catch (error) {
        console.error('Error checking statistics health:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/statistics/dashboard - Combined endpoint for all dashboard statistics
// Reduces 2 API calls (/current + /vital-rates) to 1 call
router.get('/dashboard', async (req, res) => {
    try {
        const populationService = req.app.locals.populationService;
        const calendarService = req.app.locals.calendarService;
        const years = parseInt(req.query.years) || 100;

        if (!populationService) {
            return res.status(503).json({
                success: false,
                error: 'Population service not available'
            });
        }

        const statisticsService = populationService.getStatisticsService();

        if (!statisticsService) {
            return res.status(503).json({
                success: false,
                error: 'Statistics service not available'
            });
        }

        // Get current population count from StateManager
        let currentPopulation = 0;
        try {
            const people = await StateManager.getAllPeople();
            currentPopulation = people.length;
        } catch (e) {
            console.warn('Could not get population count:', e.message);
        }

        // Get calendar date
        let currentYear = 4000;
        if (calendarService) {
            const calState = calendarService.getState();
            currentYear = calState?.currentDate?.year || 4000;
        }

        // Get current year's events from vitalEvents
        const currentYearEvents = statisticsService.vitalEvents 
            ? statisticsService.vitalEvents.filter(e => e.year === currentYear)
            : [];
        
        const currentYearBirths = currentYearEvents.reduce((sum, e) => sum + (e.births || 0), 0);
        const currentYearDeaths = currentYearEvents.reduce((sum, e) => sum + (e.deaths || 0), 0);

        // Calculate historical averages
        const allYears = statisticsService.vitalEvents 
            ? [...new Set(statisticsService.vitalEvents.map(e => e.year))]
            : [];
        const totalYears = allYears.length;
        
        let avgBirthRate = 0;
        let avgDeathRate = 0;
        
        if (totalYears > 0 && statisticsService.vitalEvents) {
            const totalBirths = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.births || 0), 0);
            const totalDeaths = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.deaths || 0), 0);
            const avgPopulation = statisticsService.vitalEvents.reduce((sum, e) => sum + (e.population || 0), 0) / statisticsService.vitalEvents.length;
            
            if (avgPopulation > 0) {
                avgBirthRate = ((totalBirths / totalYears) / avgPopulation * 1000).toFixed(2);
                avgDeathRate = ((totalDeaths / totalYears) / avgPopulation * 1000).toFixed(2);
            }
        }

        // Get today's events from the event log
        const eventLog = populationService.eventLog || [];
        const todayBirths = eventLog.filter(e => e.type === 'birth').length;
        const todayDeaths = eventLog.filter(e => e.type === 'death').length;
        const todayFamiliesFormed = eventLog.filter(e => e.type === 'family_formed').length;
        const todayPregnanciesStarted = eventLog.filter(e => e.type === 'pregnancy_started').length;

        // Get chart data
        const chartData = statisticsService.getVitalRatesForChart(years);

        res.json({
            success: true,
            summary: {
                currentPopulation,
                currentYear,
                currentYearBirths,
                currentYearDeaths,
                totalYears,
                avgBirthRate,
                avgDeathRate
            },
            today: {
                births: todayBirths,
                deaths: todayDeaths,
                familiesFormed: todayFamiliesFormed,
                pregnanciesStarted: todayPregnanciesStarted
            },
            chart: chartData,
            requestedYears: years
        });
    } catch (error) {
        console.error('Error getting dashboard statistics:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
