/**
 * Type definitions for environment variables
 */

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      
      // Database
      PGHOST: string;
      PGPORT: string;
      PGUSER: string;
      PGPASSWORD: string;
      PGDATABASE: string;
      
      // Redis
      REDIS_HOST: string;
      REDIS_PORT: string;
      REDIS_PASSWORD?: string;
      MOCK_REDIS?: string;
      
      // Calendar
      CALENDAR_INITIAL_YEAR?: string;
      CALENDAR_INITIAL_MONTH?: string;
      CALENDAR_INITIAL_DAY?: string;
      CALENDAR_MIN_YEAR?: string;
      CALENDAR_MAX_YEAR?: string;
      
      // Optional
      [key: string]: string | undefined;
    }
  }
}

export {};
