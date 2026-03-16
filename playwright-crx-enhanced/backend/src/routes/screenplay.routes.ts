import { Router } from 'express';
import { authMiddleware, optionalTenantMiddleware } from '../middleware/auth.middleware';
import {
  createTask, getTasks, getTask, updateTask, deleteTask, generateTaskCode,
  createAction, getActions, updateAction, deleteAction,
  createQuestion, getQuestions, updateQuestion, deleteQuestion,
  getPresetActions, getPresetQuestions,
} from '../controllers/screenplay.controller';

const router = Router();

// Tasks (composed business actions)
router.get('/tasks', authMiddleware, getTasks);
router.get('/tasks/:id', authMiddleware, getTask);
router.post('/tasks', authMiddleware, optionalTenantMiddleware, createTask);
router.put('/tasks/:id', authMiddleware, updateTask);
router.delete('/tasks/:id', authMiddleware, deleteTask);
router.post('/tasks/:id/generate', authMiddleware, generateTaskCode);

// Actions (low-level interactions)
router.get('/actions', authMiddleware, getActions);
router.post('/actions', authMiddleware, optionalTenantMiddleware, createAction);
router.put('/actions/:id', authMiddleware, updateAction);
router.delete('/actions/:id', authMiddleware, deleteAction);

// Questions (assertions/verifications)
router.get('/questions', authMiddleware, getQuestions);
router.post('/questions', authMiddleware, optionalTenantMiddleware, createQuestion);
router.put('/questions/:id', authMiddleware, updateQuestion);
router.delete('/questions/:id', authMiddleware, deleteQuestion);

// Presets (built-in templates)
router.get('/presets/actions', authMiddleware, getPresetActions);
router.get('/presets/questions', authMiddleware, getPresetQuestions);

export default router;
