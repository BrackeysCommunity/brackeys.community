import express from 'express';
import type { Express, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { config } from 'dotenv';
import ruleRoutes from './routes/rule-routes.js';
import infractionRoutes from './routes/infraction-routes.js';
import memberNoteRoutes from './routes/member-note-routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-middleware.js';

// Load environment variables
config();

// Initialize Express app
const app: Express = express();
const port: number = parseInt(process.env.PORT || '3001', 10);

// Apply middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(morgan('dev')); // Request logging
app.use(express.json()); // Parse JSON request bodies

// API routes
app.use('/api/guilds', ruleRoutes);
app.use('/api/guilds', infractionRoutes);
app.use('/api/guilds', memberNoteRoutes);

// Health check endpoint
app.get('/health', (_: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Handle 404 errors
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);
  console.log(`API available at http://localhost:${port}/api`);
});

export default app;
