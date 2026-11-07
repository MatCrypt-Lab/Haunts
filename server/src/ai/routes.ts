import type { FastifyInstance } from 'fastify';
import {
  aiCellQuery,
  aiChatBody,
  aiJournalBody,
  aiQuestIdeasBody,
  aiToolResultsBody,
  aiWrappedBody,
  cellToLatLng,
  getCity,
  getNeighbourhood,
  type AiStatus,
} from '@unfog/core';
import type { AppContext } from '../app';
import { parse } from '../errors';
import { loadContext } from '../services/context';
import { chat, continueWithResults, newState, openState, type AgentDeps } from './agent';
import { aiUnavailable, type AiModel } from './claude';
import { blockStory, cardCaption, crewCoach, crewPaper, dailyQuests, questIdeas, writeJournal, writeWrapped } from './features';
import { weatherAt } from './geo';

/** Photos are sent base64 inside JSON. */
const BIG_BODY = 8 * 1024 * 1024;
const perMinute = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function registerAiRoutes(app: FastifyInstance, c: AppContext): Promise<void> {
  const { db } = c;
  const model = (): AiModel => {
    if (!c.ai) throw aiUnavailable();
    return c.ai;
  };
  const agentDeps = async (userId: string): Promise<AgentDeps> => ({
    ai: model(),
    db,
    fetch: c.fetch,
    ctx: await loadContext(db, userId, c.now()),
    secret: c.config.aiStateSecret,
  });

  app.get('/ai/status', async (req): Promise<AiStatus> => {
    c.requireUser(req);
    return { enabled: c.ai !== null, model: c.ai?.model ?? null };
  });

  // ---------- Companion ----------
  app.post('/ai/chat', { bodyLimit: BIG_BODY, ...perMinute(10) }, async (req) => {
    const userId = c.requireUser(req);
    const body = parse(aiChatBody, req.body);
    const d = await agentDeps(userId);
    const s = body.state ? openState(d.secret, body.state, userId) : newState(userId, null);
    return chat(d, s, { text: body.message, localTime: body.localTime, cell: body.cell, image: body.image });
  });

  app.post('/ai/chat/tool-results', { bodyLimit: BIG_BODY, ...perMinute(20) }, async (req) => {
    const userId = c.requireUser(req);
    const body = parse(aiToolResultsBody, req.body);
    const d = await agentDeps(userId);
    return continueWithResults(d, openState(d.secret, body.state, userId), body.results);
  });

  // ---------- Walking guide ----------
  app.get('/ai/story', perMinute(20), async (req) => {
    c.requireUser(req);
    return blockStory(model(), db, c.fetch, parse(aiCellQuery, req.query).cell);
  });

  // ---------- Game master ----------
  app.get('/ai/quests', async (req) => {
    const userId = c.requireUser(req);
    return dailyQuests(model(), db, await loadContext(db, userId, c.now()));
  });

  app.get('/ai/crew/coach', async (req) => {
    const userId = c.requireUser(req);
    return crewCoach(model(), db, await loadContext(db, userId, c.now()));
  });

  app.get('/ai/crew/paper', async (req) => {
    const userId = c.requireUser(req);
    return crewPaper(model(), db, await loadContext(db, userId, c.now()));
  });

  app.get('/ai/card-caption', async (req) => {
    const userId = c.requireUser(req);
    return cardCaption(model(), db, await loadContext(db, userId, c.now()));
  });

  // ---------- Private memory writing: the phone sends a summary on request; nothing is stored ----------
  app.post('/ai/journal', perMinute(10), async (req) => {
    c.requireUser(req);
    return writeJournal(model(), parse(aiJournalBody, req.body));
  });

  app.post('/ai/wrapped', perMinute(5), async (req) => {
    c.requireUser(req);
    return writeWrapped(model(), parse(aiWrappedBody, req.body));
  });

  // ---------- Weather for rain nudges (no AI) ----------
  app.get('/weather', perMinute(30), async (req) => {
    c.requireUser(req);
    return weatherAt(c.fetch, cellToLatLng(parse(aiCellQuery, req.query).cell));
  });

  // ---------- Admin ----------
  app.post('/admin/ai/quest-ideas', async (req) => {
    c.requireAdmin(req);
    const body = parse(aiQuestIdeasBody, req.body);
    const city = getCity('blr');
    const nb = body.neighbourhoodId && city ? getNeighbourhood(city, body.neighbourhoodId) : undefined;
    return questIdeas(model(), body.brief, nb?.name ?? null, body.count);
  });
}
