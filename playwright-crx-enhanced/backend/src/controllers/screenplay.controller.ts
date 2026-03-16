import { Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { screenplayService } from '../services/bdd/screenplay.service';

// ===========================
// TASKS
// ===========================

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { name, description, actorType, actions, questions, tags } = req.body;

  if (!name) return res.status(400).json({ error: 'name is required' });

  const task = await screenplayService.createTask(userId, organizationId, {
    name, description, actorType, actions, questions, tags,
  });
  return res.status(201).json({ success: true, data: task });
});

export const getTasks = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const tasks = await screenplayService.getTasks(userId, organizationId);
  return res.json({ success: true, data: tasks });
});

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const task = await screenplayService.getTask(req.params.id, userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json({ success: true, data: task });
});

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const task = await screenplayService.updateTask(req.params.id, userId, req.body);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  return res.json({ success: true, data: task });
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const deleted = await screenplayService.deleteTask(req.params.id, userId);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });
  return res.json({ success: true, message: 'Task deleted' });
});

export const generateTaskCode = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const code = await screenplayService.generateTaskStepDefinition(req.params.id, userId);
  return res.json({ success: true, data: { code } });
});

// ===========================
// ACTIONS
// ===========================

export const createAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { name, description, actionType, target, value, code, tags } = req.body;

  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

  const action = await screenplayService.createAction(userId, organizationId, {
    name, description, actionType, target, value, code, tags,
  });
  return res.status(201).json({ success: true, data: action });
});

export const getActions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const actions = await screenplayService.getActions(userId, organizationId);
  return res.json({ success: true, data: actions });
});

export const updateAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const action = await screenplayService.updateAction(req.params.id, userId, req.body);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  return res.json({ success: true, data: action });
});

export const deleteAction = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const deleted = await screenplayService.deleteAction(req.params.id, userId);
  if (!deleted) return res.status(404).json({ error: 'Action not found' });
  return res.json({ success: true, message: 'Action deleted' });
});

// ===========================
// QUESTIONS
// ===========================

export const createQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const { name, description, questionType, target, expected, code, tags } = req.body;

  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

  const question = await screenplayService.createQuestion(userId, organizationId, {
    name, description, questionType, target, expected, code, tags,
  });
  return res.status(201).json({ success: true, data: question });
});

export const getQuestions = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const organizationId = req.tenant?.organizationId || null;
  const questions = await screenplayService.getQuestions(userId, organizationId);
  return res.json({ success: true, data: questions });
});

export const updateQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const question = await screenplayService.updateQuestion(req.params.id, userId, req.body);
  if (!question) return res.status(404).json({ error: 'Question not found' });
  return res.json({ success: true, data: question });
});

export const deleteQuestion = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const deleted = await screenplayService.deleteQuestion(req.params.id, userId);
  if (!deleted) return res.status(404).json({ error: 'Question not found' });
  return res.json({ success: true, message: 'Question deleted' });
});

// ===========================
// PRESETS
// ===========================

export const getPresetActions = asyncHandler(async (_req: Request, res: Response) => {
  const presets = screenplayService.getPresetActions();
  return res.json({ success: true, data: presets });
});

export const getPresetQuestions = asyncHandler(async (_req: Request, res: Response) => {
  const presets = screenplayService.getPresetQuestions();
  return res.json({ success: true, data: presets });
});
