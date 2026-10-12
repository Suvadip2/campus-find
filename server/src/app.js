import express from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { evaluatePossibleMatch } from './matching.js';
import { readModerationData, updateModerationData } from './moderation-store.js';
import { isActiveListing, listingStatus, normalizeListingStatus, readItems, updateItems } from './store.js';
import {
  authenticateUser,
  createSession,
  deleteSession,
  publicUser,
  registerStudent,
  userForSession
} from './auth-store.js';

const allowedCategories = new Set(['Electronics', 'Keys', 'Bags', 'Books', 'Clothing', 'Other']);
let requestCount = 0;
const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;
const maxImageSize = 1024 * 1024;
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageSize, files: 1, fields: 8, fieldSize: 2000 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('Use a JPG, PNG, GIF, or WebP image.'));
      return;
    }
    callback(null, true);
  }
}).single('image');

function imageMatchesMimeType(file) {
  const { buffer, mimetype } = file;
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'image/gif') return buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
  if (mimetype === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((request, response, next) => {
  requestCount += 1;
  next();
});
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

function readSessionToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.get('authorization') ?? '');
  return match?.[1] ?? null;
}

async function requireUser(request, response, next) {
  try {
    const user = await userForSession(readSessionToken(request));
    if (!user) return response.status(401).json({ error: 'Sign in to continue.' });
    request.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') {
    return response.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicListing(item) {
  const listing = { ...item };
  delete listing.matchId;
  delete listing.matchedItemId;
  delete listing.matchConfirmations;
  delete listing.matchScore;
  delete listing.matchDetails;
  return listing;
}

function matchForUser(item, counterpart, userId) {
  return {
    id: item.matchId,
    listings: [publicListing(item), publicListing(counterpart)],
    score: item.matchScore,
    details: item.matchDetails,
    confirmationCount: item.matchConfirmations?.length ?? 0,
    requiredConfirmations: 2,
    confirmedByCurrentUser: item.matchConfirmations?.includes(userId) ?? false
  };
}

function clearMatch(item, counterpart) {
  for (const listing of [item, counterpart]) {
    delete listing.matchId;
    delete listing.matchedItemId;
    delete listing.matchScore;
    delete listing.matchDetails;
    delete listing.matchConfirmations;
  }
}

function connectPossibleMatch(items, item, userId) {
  const candidate = items
    .map((listing) => ({ listing, result: evaluatePossibleMatch(item, listing) }))
    .filter(({ listing, result }) => result && !listing.matchId)
    .sort((left, right) => right.result.score - left.result.score)[0];
  if (!candidate) return null;

  const matchId = randomUUID();
  item.matchId = matchId;
  item.matchedItemId = candidate.listing.id;
  item.matchScore = candidate.result.score;
  item.matchDetails = candidate.result.details;
  item.matchConfirmations = [];
  candidate.listing.matchId = matchId;
  candidate.listing.matchedItemId = item.id;
  candidate.listing.matchScore = candidate.result.score;
  candidate.listing.matchDetails = candidate.result.details;
  candidate.listing.matchConfirmations = [];
  return matchForUser(item, candidate.listing, userId);
}

function loginRateLimit(request, response, next) {
  const attempts = loginAttempts.get(request.ip);
  if (!attempts || attempts.resetAt <= Date.now()) {
    loginAttempts.delete(request.ip);
    return next();
  }
  if (attempts.count >= maxLoginAttempts) {
    response.set('Retry-After', Math.ceil((attempts.resetAt - Date.now()) / 1000));
    return response.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
  }
  next();
}

function recordFailedLogin(request) {
  const now = Date.now();
  const attempts = loginAttempts.get(request.ip);
  if (!attempts || attempts.resetAt <= now) {
    loginAttempts.set(request.ip, { count: 1, resetAt: now + loginWindowMs });
    return;
  }
  attempts.count += 1;
}

function clearFailedLogins(request) {
  loginAttempts.delete(request.ip);
}

app.post('/api/auth/register', async (request, response, next) => {
  const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  if (name.length < 2 || name.length > 80 || !validEmail(email) || typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return response.status(400).json({ error: 'Enter your name, a valid email, and a password of at least 6 characters.' });
  }
  try {
    const user = await registerStudent({ name, email, password });
    if (!user) return response.status(409).json({ error: 'An account with this email already exists.' });
    const session = await createSession(user.id);
    response.status(201).json({ user: publicUser(user), token: session.token });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', loginRateLimit, async (request, response, next) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = request.body?.password;
  const role = request.body?.role;
  try {
    if (!validEmail(email) || typeof password !== 'string' || !['student', 'admin'].includes(role)) {
      await authenticateUser('invalid@example.invalid', typeof password === 'string' ? password : '', role === 'admin' ? 'admin' : 'student');
      recordFailedLogin(request);
      return response.status(401).json({ error: 'Email, password, or account type is incorrect.' });
    }
    const user = await authenticateUser(email, password, role);
    if (!user) {
      recordFailedLogin(request);
      return response.status(401).json({ error: 'Email, password, or account type is incorrect.' });
    }
    clearFailedLogins(request);
    const session = await createSession(user.id);
    response.json({ user: publicUser(user), token: session.token });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', async (request, response, next) => {
  try {
    const user = await userForSession(readSessionToken(request));
    response.set('Cache-Control', 'no-store').json({ user: user ? publicUser(user) : null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (request, response, next) => {
  try {
    await deleteSession(readSessionToken(request));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', service: 'campus-find-api', timestamp: new Date().toISOString() });
});

app.get('/api/metrics', async (_request, response, next) => {
  try {
    const items = await readItems();
    response.type('text/plain; version=0.0.4').send([
      '# HELP campus_find_http_requests_total Total HTTP requests served since process start.',
      '# TYPE campus_find_http_requests_total counter',
      `campus_find_http_requests_total ${requestCount}`,
      '# HELP campus_find_items Current number of listings.',
      '# TYPE campus_find_items gauge',
      `campus_find_items ${items.filter(isActiveListing).length}`
    ].join('\n') + '\n');
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', requireUser, async (_request, response, next) => {
  try {
    const items = await readItems();
    response.json(items.filter(isActiveListing).map(publicListing));
  } catch (error) {
    next(error);
  }
});

app.get('/api/my/items', requireUser, async (request, response, next) => {
  if (request.user.role !== 'student') {
    return response.status(403).json({ error: 'This listing history is available to student accounts.' });
  }
  try {
    const items = await readItems();
    response.json(items.filter((item) => item.ownerId === request.user.id).map(publicListing));
  } catch (error) {
    next(error);
  }
});

app.get('/api/matches', requireUser, async (request, response, next) => {
  try {
    const items = await readItems();
    const matches = [];
    const seen = new Set();
    for (const item of items) {
      if (!isActiveListing(item) || !item.matchId || seen.has(item.matchId)) continue;
      const counterpart = items.find((entry) => entry.id === item.matchedItemId && entry.matchId === item.matchId);
      if (!counterpart || !isActiveListing(counterpart)) continue;
      if (item.ownerId !== request.user.id && counterpart.ownerId !== request.user.id) continue;
      matches.push(matchForUser(item, counterpart, request.user.id));
      seen.add(item.matchId);
    }
    response.set('Cache-Control', 'no-store').json(matches);
  } catch (error) {
    next(error);
  }
});

app.post('/api/items', requireUser, (request, response, next) => {
  if (request.user.role !== 'student') {
    response.status(403).json({ error: 'Administrator accounts cannot post student listings.' });
    return;
  }
  uploadImage(request, response, (uploadError) => {
    if (uploadError) {
      const status = uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      response.status(status).json({
        error: status === 413 ? 'Item photos must be 1 MB or smaller after processing.' : uploadError.message
      });
      return;
    }
    if (request.file && !imageMatchesMimeType(request.file)) {
      response.status(400).json({ error: 'The selected file is not a valid image.' });
      return;
    }
    next();
  });
}, async (request, response, next) => {
  const { title, description, category, type, location, brand = '', color = '' } = request.body ?? {};
  if (![title, description, category, type, location].every((value) => typeof value === 'string' && value.trim())) {
    return response.status(400).json({ error: 'Complete all listing fields.' });
  }
  if ([brand, color].some((value) => typeof value !== 'string') ||
    title.length > 80 || description.length > 500 || location.length > 100 || brand.length > 80 || color.length > 40) {
    return response.status(400).json({ error: 'One or more fields exceed the allowed length.' });
  }
  if (!allowedCategories.has(category) || !['lost', 'found'].includes(type)) {
    return response.status(400).json({ error: 'Check the listing category and type.' });
  }

  try {
    const result = await updateItems((items) => {
      const item = {
        id: randomUUID(),
        title: title.trim(),
        description: description.trim(),
        category,
        type,
        location: location.trim(),
        brand: brand.trim(),
        color: color.trim(),
        contact: request.user.email,
        ownerId: request.user.id,
        ...(request.file ? { image: `data:${request.file.mimetype};base64,${request.file.buffer.toString('base64')}` } : {}),
        status: listingStatus.ACTIVE,
        createdAt: new Date().toISOString()
      };
      const match = connectPossibleMatch(items, item, request.user.id);
      items.unshift(item);
      return { item: publicListing(item), match };
    });
    response.status(201).json({ ...result.item, possibleMatch: result.match });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id', requireUser, async (request, response, next) => {
  if (request.user.role !== 'student') {
    return response.status(403).json({ error: 'Only student accounts can edit listings.' });
  }
  const editableFields = ['title', 'description', 'location', 'brand', 'color'];
  const updates = request.body ?? {};
  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((key) => !editableFields.includes(key)) ||
    keys.some((key) => typeof updates[key] !== 'string')) {
    return response.status(400).json({ error: 'Provide valid listing fields to update.' });
  }
  const limits = { title: 80, description: 500, location: 100, brand: 80, color: 40 };
  if (Object.entries(updates).some(([key, value]) =>
    value.length > limits[key] || (['title', 'description', 'location'].includes(key) && !value.trim()))) {
    return response.status(400).json({ error: 'One or more fields are empty or exceed the allowed length.' });
  }

  try {
    const result = await updateItems((items) => {
      const item = items.find((entry) => entry.id === request.params.id);
      if (!item) return { status: 404, error: 'Listing not found.' };
      if (item.ownerId !== request.user.id) {
        return { status: 403, error: 'You can only edit listings you posted.' };
      }
      if (!isActiveListing(item)) return { status: 409, error: 'Only active listings can be edited.' };

      if (item.matchId) {
        const counterpart = items.find((entry) => entry.id === item.matchedItemId && entry.matchId === item.matchId);
        if (counterpart) clearMatch(item, counterpart);
      }
      for (const [key, value] of Object.entries(updates)) {
        item[key] = value.trim();
      }
      return {
        status: 200,
        item: publicListing(item),
        possibleMatch: connectPossibleMatch(items, item, request.user.id)
      };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/items/:id', requireUser, async (request, response, next) => {
  if (request.user.role !== 'student') {
    return response.status(403).json({ error: 'Only student accounts can delete listings.' });
  }
  try {
    const result = await updateItems((items) => {
      const index = items.findIndex((entry) => entry.id === request.params.id);
      if (index === -1) return { status: 404, error: 'Listing not found.' };
      const item = items[index];
      if (item.ownerId !== request.user.id) {
        return { status: 403, error: 'You can only delete listings you posted.' };
      }
      if (!isActiveListing(item)) return { status: 409, error: 'Only active listings can be deleted.' };

      if (item.matchId) {
        const counterpart = items.find((entry) => entry.id === item.matchedItemId && entry.matchId === item.matchId);
        if (counterpart) clearMatch(item, counterpart);
      }
      items.splice(index, 1);
      return { status: 200, id: item.id };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });
    response.json({ id: result.id });
  } catch (error) {
    next(error);
  }
});

app.post('/api/matches/:id/confirm-returned', requireUser, async (request, response, next) => {
  try {
    const result = await updateItems((items) => {
      const first = items.find((item) => item.matchId === request.params.id);
      if (!first) return { status: 404, error: 'Possible match not found.' };
      const second = items.find((item) => item.id === first.matchedItemId && item.matchId === first.matchId);
      if (!second || second.matchedItemId !== first.id || first.id === second.id ||
        first.ownerId === second.ownerId || first.type === second.type) {
        return { status: 409, error: 'This possible match is invalid and cannot be confirmed.' };
      }
      if (!isActiveListing(first) || !isActiveListing(second)) {
        return { status: 409, error: 'This possible match is no longer active.' };
      }
      if (first.ownerId !== request.user.id && second.ownerId !== request.user.id) {
        return { status: 403, error: 'Only one of the two listing owners can confirm this return.' };
      }

      const confirmations = new Set([
        ...(first.matchConfirmations ?? []),
        ...(second.matchConfirmations ?? [])
      ]);
      if (confirmations.has(request.user.id)) {
        return { status: 409, error: 'You have already confirmed this return.' };
      }
      confirmations.add(request.user.id);
      first.matchConfirmations = [...confirmations];
      second.matchConfirmations = [...confirmations];

      const resolved = confirmations.has(first.ownerId) && confirmations.has(second.ownerId);
      if (resolved) {
        const resolvedAt = new Date().toISOString();
        first.status = listingStatus.RESOLVED;
        second.status = listingStatus.RESOLVED;
        first.resolvedAt = resolvedAt;
        second.resolvedAt = resolvedAt;
      }
      return {
        status: 200,
        resolved,
        confirmationCount: confirmations.size,
        requiredConfirmations: 2,
        listings: [publicListing(first), publicListing(second)]
      };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/items/:id/reports', requireUser, async (request, response, next) => {
  if (request.user.role !== 'student') {
    return response.status(403).json({ error: 'Only student accounts can report listings.' });
  }
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    return response.status(400).json({ error: 'Provide a report reason between 3 and 500 characters.' });
  }
  try {
    const item = (await readItems()).find((entry) => entry.id === request.params.id);
    if (!item) return response.status(404).json({ error: 'Listing not found.' });
    if (item.ownerId === request.user.id) return response.status(403).json({ error: 'You cannot report your own listing.' });
    if (!isActiveListing(item)) return response.status(409).json({ error: 'Only active listings can be reported.' });

    const report = await updateModerationData((data) => {
      const existing = data.reports.find((entry) =>
        entry.itemId === item.id && entry.reporterId === request.user.id && entry.status === 'pending'
      );
      if (existing) return { status: 409, error: 'You already have a pending report for this listing.' };
      const created = {
        id: randomUUID(),
        itemId: item.id,
        reporterId: request.user.id,
        reporterName: request.user.name,
        reason,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      data.reports.unshift(created);
      data.auditTrail.unshift({
        id: randomUUID(),
        action: 'report_submitted',
        actorId: request.user.id,
        actorName: request.user.name,
        targetType: 'listing',
        targetId: item.id,
        details: { reportId: created.id, reason },
        createdAt: created.createdAt
      });
      return { status: 201, report: created };
    });
    if (report.status !== 201) return response.status(report.status).json({ error: report.error });
    response.status(201).json({ report: report.report });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/dashboard', requireUser, requireAdmin, async (request, response, next) => {
  try {
    const [items, moderation] = await Promise.all([readItems(), readModerationData()]);
    const pendingMatches = [];
    const seenMatches = new Set();
    for (const item of items) {
      if (!isActiveListing(item) || !item.matchId || seenMatches.has(item.matchId)) continue;
      const counterpart = items.find((entry) => entry.id === item.matchedItemId && entry.matchId === item.matchId);
      if (!counterpart || !isActiveListing(counterpart)) continue;
      pendingMatches.push(matchForUser(item, counterpart, request.user.id));
      seenMatches.add(item.matchId);
    }
    const itemById = new Map(items.map((item) => [item.id, item]));
    response.json({
      stats: {
        totalListings: items.length,
        activeLost: items.filter((item) => isActiveListing(item) && item.type === 'lost').length,
        activeFound: items.filter((item) => isActiveListing(item) && item.type === 'found').length,
        pendingMatches: pendingMatches.length,
        resolvedItems: items.filter((item) => normalizeListingStatus(item.status) === listingStatus.RESOLVED).length
      },
      activeListings: items.filter(isActiveListing).map(publicListing),
      resolvedHistory: items
        .filter((item) => normalizeListingStatus(item.status) === listingStatus.RESOLVED)
        .map(publicListing),
      removedHistory: items
        .filter((item) => normalizeListingStatus(item.status) === listingStatus.REMOVED)
        .map(publicListing),
      pendingMatches,
      reports: moderation.reports.map((report) => ({
        ...report,
        listing: itemById.has(report.itemId) ? publicListing(itemById.get(report.itemId)) : null
      })),
      auditTrail: moderation.auditTrail.slice(0, 100)
    });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/reports/:id', requireUser, requireAdmin, async (request, response, next) => {
  if (request.body?.action !== 'dismiss') {
    return response.status(400).json({ error: 'The supported report action is dismiss.' });
  }
  try {
    const result = await updateModerationData((data) => {
      const report = data.reports.find((entry) => entry.id === request.params.id);
      if (!report) return { status: 404, error: 'Report not found.' };
      if (report.status !== 'pending') return { status: 409, error: 'This report has already been reviewed.' };
      report.status = 'dismissed';
      report.reviewedAt = new Date().toISOString();
      report.reviewedBy = request.user.id;
      data.auditTrail.unshift({
        id: randomUUID(),
        action: 'report_dismissed',
        actorId: request.user.id,
        actorName: request.user.name,
        targetType: 'report',
        targetId: report.id,
        details: { itemId: report.itemId, reason: report.reason },
        createdAt: report.reviewedAt
      });
      return { status: 200, report };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });
    response.json({ report: result.report });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/items/:id/remove', requireUser, requireAdmin, async (request, response, next) => {
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    return response.status(400).json({ error: 'Provide a moderation reason between 3 and 500 characters.' });
  }
  try {
    const result = await updateItems((items) => {
      const item = items.find((entry) => entry.id === request.params.id);
      if (!item) return { status: 404, error: 'Listing not found.' };
      if (normalizeListingStatus(item.status) === listingStatus.REMOVED) {
        return { status: 409, error: 'This listing has already been removed.' };
      }
      const pairedItem = item.matchId
        ? items.find((entry) => entry.id === item.matchedItemId && entry.matchId === item.matchId)
        : null;
      const previousStatus = item.status;
      item.status = listingStatus.REMOVED;
      item.removedAt = new Date().toISOString();
      item.removedBy = request.user.id;
      item.removalReason = reason;
      if (pairedItem) {
        delete pairedItem.matchId;
        delete pairedItem.matchedItemId;
        delete pairedItem.matchScore;
        delete pairedItem.matchDetails;
        delete pairedItem.matchConfirmations;
      }
      return {
        status: 200,
        item: publicListing(item),
        pairedItemId: pairedItem?.id ?? null,
        previousStatus,
        removedAt: item.removedAt
      };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });

    await updateModerationData((data) => {
      for (const report of data.reports) {
        if (report.itemId === request.params.id && report.status === 'pending') {
          report.status = 'actioned';
          report.reviewedAt = result.removedAt;
          report.reviewedBy = request.user.id;
        }
      }
      data.auditTrail.unshift({
        id: randomUUID(),
        action: 'listing_removed',
        actorId: request.user.id,
        actorName: request.user.name,
        targetType: 'listing',
        targetId: request.params.id,
        details: {
          reason,
          previousStatus: result.previousStatus,
          pairedItemId: result.pairedItemId
        },
        createdAt: result.removedAt
      });
      return null;
    });
    response.json({ item: result.item, pairedItemId: result.pairedItemId });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/items/:id/resolve', requireUser, async (request, response, next) => {
  try {
    const result = await updateItems((items) => {
      const item = items.find((entry) => entry.id === request.params.id);
      if (!item) return { status: 404, error: 'Listing not found.' };
      if (item.ownerId !== request.user.id || request.user.role !== 'student') {
        return { status: 403, error: 'You can only resolve listings you posted.' };
      }
      if (item.matchId) {
        return { status: 409, error: 'This listing has a possible match. Both owners must confirm the return together.' };
      }
      if (!isActiveListing(item)) return { status: 409, error: 'This listing is not active.' };
      item.status = listingStatus.RESOLVED;
      item.resolvedAt = new Date().toISOString();
      return { status: 200, item: publicListing(item) };
    });
    if (result.status !== 200) return response.status(result.status).json({ error: result.error });
    response.json(result.item);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error('API request failed:', error);
  response.status(500).json({ error: 'An internal server error occurred.' });
});
