// Population Statistics API Routes
const express = require('express');
const router = express.Router();

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

module.exports = router;
