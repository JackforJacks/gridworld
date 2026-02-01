import express, { Router } from 'express';
import { validateBody } from '../middleware/validate';
import { SetDateSchema, SetIntervalSchema, SetSpeedSchema } from '../schemas';

const router: Router = express.Router();

/**
 * Calendar API Routes
 * Provides REST endpoints for calendar system management
 */

// GET /api/calendar/state - Get current calendar state
router.get('/state', (req, res) => {
    try {
        const state = req.app.locals.calendarService.getState();
        res.json({
            success: true,
            data: state
        });
    } catch (error: unknown) {
        console.error('Error getting calendar state:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get calendar state'
        });
    }
});

// GET /api/calendar/stats - Get calendar statistics
router.get('/stats', (req, res) => {
    try {
        const stats = req.app.locals.calendarService.getStats();
        res.json({
            success: true,
            data: stats
        });
    } catch (error: unknown) {
        console.error('Error getting calendar stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get calendar statistics'
        });
    }
});

// POST /api/calendar/start - Start the calendar ticking
router.post('/start', (req, res) => {
    try {
        const result = req.app.locals.calendarService.start();
        res.json({
            success: true,
            data: {
                started: result,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error starting calendar:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start calendar'
        });
    }
});

// POST /api/calendar/stop - Stop the calendar ticking
router.post('/stop', (req, res) => {
    try {
        const result = req.app.locals.calendarService.stop();
        res.json({
            success: true,
            data: {
                stopped: result,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error stopping calendar:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop calendar'
        });
    }
});

// POST /api/calendar/reset - Reset calendar to initial state
router.post('/reset', (req, res) => {
    try {
        const result = req.app.locals.calendarService.reset();
        res.json({
            success: true,
            data: {
                reset: result,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error resetting calendar:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset calendar'
        });
    }
});

// POST /api/calendar/date - Set specific date
router.post('/date', validateBody(SetDateSchema), (req, res) => {
    try {
        const { year, month, day } = req.body;

        const result = req.app.locals.calendarService.setDate(year, month, day);

        res.json({
            success: true,
            data: {
                dateSet: result,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error setting calendar date:', error);
        res.status(400).json({
            success: false,
            error: (error as Error).message || 'Failed to set calendar date'
        });
    }
});

// POST /api/calendar/interval - Change tick interval
router.post('/interval', validateBody(SetIntervalSchema), (req, res) => {
    try {
        const { intervalMs } = req.body;

        const result = req.app.locals.calendarService.setTickInterval(intervalMs);

        res.json({
            success: true,
            data: {
                intervalSet: result,
                newInterval: intervalMs,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error setting calendar interval:', error);
        res.status(400).json({
            success: false,
            error: (error as Error).message || 'Failed to set tick interval'
        });
    }
});

// GET /api/calendar/speeds - Get available speed modes
router.get('/speeds', (req, res) => {
    try {
        const speeds = req.app.locals.calendarService.getAvailableSpeeds();
        res.json({
            success: true,
            data: speeds
        });
    } catch (error: unknown) {
        console.error('Error getting calendar speeds:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get available speeds'
        });
    }
});

// POST /api/calendar/speed - Change calendar speed
router.post('/speed', validateBody(SetSpeedSchema), (req, res) => {
    try {
        const { speed } = req.body;

        const result = req.app.locals.calendarService.setSpeed(speed);

        res.json({
            success: true,
            data: {
                speedSet: result,
                newSpeed: speed,
                state: req.app.locals.calendarService.getState()
            }
        });
    } catch (error: unknown) {
        console.error('Error setting calendar speed:', error);
        res.status(400).json({
            success: false,
            error: (error as Error).message || 'Failed to set calendar speed'
        });
    }
});

// GET /api/calendar/config - Get calendar configuration
router.get('/config', (req, res) => {
    try {
        const state = req.app.locals.calendarService.getState();
        res.json({
            success: true,
            data: state.config
        });
    } catch (error: unknown) {
        console.error('Error getting calendar config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get calendar configuration'
        });
    }
});

export default router;
