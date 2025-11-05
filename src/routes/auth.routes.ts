// src/routes/auth.routes.ts
import express from 'express';
import { signin } from '../controllers/auth.controller';

const router = express.Router();

router.post('/signin', signin);

// (Optionally) router.post('/signup', signup)

export default router;
