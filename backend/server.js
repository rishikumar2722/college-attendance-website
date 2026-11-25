const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');

dotenv.config({ path: path.join(__dirname, '.env') });

// Database configuration
const connectDB = require('./config/db');

// Route imports
const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const studentRequestRoutes = require('./routes/studentRequestRoutes');
const parentNotificationRoutes = require('./routes/parentNotificationRoutes');
const staffMessageRoutes = require('./routes/staffMessageRoutes');

// Express application
const app = express();

// Server configuration
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const DB_RETRY_DELAY_MS = 5000;

// Trust proxy configuration
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = (
    process.env.FRONTEND_ORIGIN || 'http://localhost:5500'
)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests without an Origin header
            if (!origin) {
                return callback(null, true);
            }

            // Allow configured frontend origins
            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            if (process.env.NODE_ENV !== 'production') {
                console.warn(`CORS blocked origin: ${origin}`);
            }

            return callback(new Error('Origin not allowed by CORS'));
        },

        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

        allowedHeaders: ['Content-Type', 'Authorization'],

        credentials: true
    })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
    const connected = mongoose.connection.readyState === 1;

    res.status(connected ? 200 : 503).json({
        status: connected ? 'OK' : 'DATABASE_DISCONNECTED',
        service: 'College Attendance Management API',
        database: connected ? 'Connected' : 'Disconnected',
        timestamp: new Date().toISOString()
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', parentNotificationRoutes);
app.use('/api/messages', staffMessageRoutes);
app.use('/api/student-requests', studentRequestRoutes);
app.use('/api/student-registration-requests', studentRequestRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Endpoint ${req.originalUrl} not found`
    });
});

// Central error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);

    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal Server Error',

        stack: process.env.NODE_ENV === 'production'
            ? undefined
            : err.stack
    });
});

// MongoDB reconnection mechanism
let reconnectTimer = null;

function retryDatabaseConnection() {
    if (reconnectTimer) {
        return;
    }

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;

        try {
            console.log('Attempting MongoDB reconnection...');

            await connectDB();

            console.log('MongoDB reconnected successfully.');

        } catch (error) {
            console.error(
                `MongoDB reconnection failed. Retrying in ${DB_RETRY_DELAY_MS / 1000} seconds.`
            );

            retryDatabaseConnection();
        }
    }, DB_RETRY_DELAY_MS);
}

// Start application
async function startServer() {
    try {
        // Start HTTP server only once
        const server = app.listen(PORT, HOST, () => {
            console.log('===========================================');
            console.log('College Attendance Management System');
            console.log('===========================================');
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Server running on: http://${HOST}:${PORT}`);
            console.log(`API Base URL: http://localhost:${PORT}/api`);
            console.log(`Health Check: http://localhost:${PORT}/api/health`);
            console.log(`Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
            console.log('===========================================');
        });

        server.on('error', (error) => {
            console.error('HTTP Server Error:', error.message);
            process.exit(1);
        });

        // Connect to MongoDB
        try {
            console.log('Connecting to MongoDB...');

            await connectDB();

            console.log('MongoDB connection established.');

        } catch (error) {
            console.error('===========================================');
            console.error('MongoDB connection failed');
            console.error('===========================================');
            console.error(error.message);

            console.error(
                `Retrying database connection every ${DB_RETRY_DELAY_MS / 1000} seconds.`
            );

            // Keep API running while retrying MongoDB
            retryDatabaseConnection();
        }

    } catch (error) {
        console.error('Application startup failed:', error.message);
        process.exit(1);
    }
}

// Handle unexpected errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Promise Rejection:', reason);
    process.exit(1);
});

// Start the application
startServer();

module.exports = app;
