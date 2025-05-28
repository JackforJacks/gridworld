// Error Handler Middleware
module.exports = (err, req, res, next) => {
    console.error('🚨 Server Error:', err);

    // Default error response
    const errorResponse = {
        success: false,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    };

    // Handle specific error types
    if (err.name === 'ValidationError') {
        errorResponse.error = 'Validation Error';
        errorResponse.message = err.message;
        return res.status(400).json(errorResponse);
    }

    if (err.name === 'CastError') {
        errorResponse.error = 'Invalid ID';
        errorResponse.message = 'Invalid ID format';
        return res.status(400).json(errorResponse);
    }

    if (err.message && err.message.includes('required')) {
        errorResponse.error = 'Missing Required Data';
        errorResponse.message = err.message;
        return res.status(400).json(errorResponse);
    }

    // Default 500 error
    res.status(500).json(errorResponse);
};
