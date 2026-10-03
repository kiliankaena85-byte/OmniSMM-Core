import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// 1. Force load .env.test into process.env before ANYTHING else evaluates
const envTestPath = path.resolve(process.cwd(), '.env.test');
if (fs.existsSync(envTestPath)) {
  dotenv.config({ path: envTestPath, override: true });
}

// 2. Explicitly ensure environment flags are set to test and force test database
process.env.NODE_ENV = 'test';
process.env.CONTOUR = 'test';
process.env.VITEST = 'true';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5435/smmplan_test?schema=public&sslmode=disable';
process.env.DATABASE_URL_TEST = 'postgresql://postgres:postgres@127.0.0.1:5435/smmplan_test?schema=public&sslmode=disable';
