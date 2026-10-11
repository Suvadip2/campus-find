import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'campus-find-test-'));
process.env.DATA_DIR = dataDirectory;
process.env.ADMIN_EMAIL = 'admin@example.edu';
process.env.ADMIN_PASSWORD = 'test-admin-password-123';
const [{ app }, { initializeAdmin }] = await Promise.all([
  import('../src/app.js'),
  import('../src/auth-store.js')
]);
let server;
let baseUrl;
let studentCookie;
let studentId;
let studentItemId;
let adminCookie;
let foundOwnerCookie;
let unrelatedOwnerCookie;
let lostMatchId;
let foundMatchId;

async function postJson(pathname, body, cookie) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: JSON.stringify(body)
  });
}

before(async () => {
  await initializeAdmin();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(dataDirectory, { recursive: true, force: true });
});

test('health endpoint reports the API as ready', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('lists seed items and exposes scrapeable metrics', async () => {
  const unauthorizedListings = await fetch(`${baseUrl}/api/items`);
  assert.equal(unauthorizedListings.status, 401);
  assert.equal(unauthorizedListings.headers.get('cache-control'), 'no-store');
  const metrics = await fetch(`${baseUrl}/api/metrics`);
  assert.match(await metrics.text(), /campus_find_items 4/);
});

test('registers a student, starts a session, and creates a listing', async () => {
  const registered = await postJson('/api/auth/register', {
    name: 'Campus Student',
    email: 'student@example.edu',
    password: 'stud12'
  });
  assert.equal(registered.status, 201);
  assert.match(registered.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(registered.headers.get('set-cookie'), /SameSite=Strict/i);
  studentCookie = registered.headers.get('set-cookie').split(';')[0];
  const user = (await registered.json()).user;
  studentId = user.id;
  assert.equal(user.role, 'student');

  const duplicate = await postJson('/api/auth/register', {
    name: 'Campus Student',
    email: 'STUDENT@example.edu',
    password: 'student-password-123'
  });
  assert.equal(duplicate.status, 409);

  const weakPassword = await postJson('/api/auth/register', {
    name: 'Another Student',
    email: 'another@example.edu',
    password: 'short'
  });
  assert.equal(weakPassword.status, 400);

  const currentUser = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: studentCookie } });
  assert.equal((await currentUser.json()).user.id, studentId);
  const authorizedListings = await fetch(`${baseUrl}/api/items`, { headers: { Cookie: studentCookie } });
  assert.equal(authorizedListings.status, 200);
  assert.equal((await authorizedListings.json()).length, 4);

  const unauthorized = await postJson('/api/items', {});
  assert.equal(unauthorized.status, 401);

  const payload = {
    title: 'Moleskine notebook',
    description: 'Red cover with a black elastic band',
    category: 'Books',
    type: 'lost',
    location: 'Lecture Hall 2',
    contact: 'attacker@example.edu',
    brand: 'Moleskine',
    color: 'red'
  };
  const created = await postJson('/api/items', payload, studentCookie);
  assert.equal(created.status, 201);
  const item = await created.json();
  studentItemId = item.id;
  assert.equal(item.title, payload.title);
  assert.equal(item.contact, 'student@example.edu');
  assert.equal(item.ownerId, studentId);
  assert.equal(item.brand, payload.brand);
  assert.equal(item.color, payload.color);
  const ownListings = await fetch(`${baseUrl}/api/my/items`, { headers: { Cookie: studentCookie } });
  assert.equal(ownListings.status, 200);
  assert.ok((await ownListings.json()).some((entry) => entry.id === studentItemId));

  const invalid = await postJson('/api/items', { ...payload, category: 'Invalid' }, studentCookie);
  assert.equal(invalid.status, 400);

  const photo = new FormData();
  const photoPayload = { ...payload, title: 'Camera strap', description: 'Black strap with a clip', category: 'Other', type: 'found' };
  for (const [key, value] of Object.entries(photoPayload)) {
    photo.set(key, value);
  }
  photo.set('image', new Blob([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  ], { type: 'image/png' }), 'notebook.png');
  const photoResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { Cookie: studentCookie },
    body: photo
  });
  assert.equal(photoResponse.status, 201);
  const photoItem = await photoResponse.json();
  assert.match(photoItem.image, /^data:image\/png;base64,/);

  const spoofedPhoto = new FormData();
  for (const [key, value] of Object.entries(photoPayload)) {
    spoofedPhoto.set(key, value);
  }
  spoofedPhoto.set('image', new Blob(['not an image'], { type: 'image/png' }), 'spoof.png');
  const spoofedResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { Cookie: studentCookie },
    body: spoofedPhoto
  });
  assert.equal(spoofedResponse.status, 400);

  const unsupportedPhoto = new FormData();
  for (const [key, value] of Object.entries(photoPayload)) {
    unsupportedPhoto.set(key, value);
  }
  unsupportedPhoto.set('image', new Blob(['not an image'], { type: 'image/svg+xml' }), 'spoof.svg');
  const unsupportedResponse = await fetch(`${baseUrl}/api/items`, {
    method: 'POST',
    headers: { Cookie: studentCookie },
    body: unsupportedPhoto
  });
  assert.equal(unsupportedResponse.status, 400);
});

test('matches opposing listings, requires both owners, and retains resolved history', async () => {
  const foundRegistration = await postJson('/api/auth/register', {
    name: 'Found Item Owner',
    email: 'finder@example.edu',
    password: 'find12'
  });
  assert.equal(foundRegistration.status, 201);
  foundOwnerCookie = foundRegistration.headers.get('set-cookie').split(';')[0];

  const found = await postJson('/api/items', {
    title: 'Moleskine notebook',
    description: 'Red cover with a black elastic band, picked up after lecture',
    category: 'Books',
    type: 'found',
    location: 'Lecture Hall 2',
    brand: 'Moleskine',
    color: 'red'
  }, foundOwnerCookie);
  assert.equal(found.status, 201);
  const foundBody = await found.json();
  foundMatchId = foundBody.id;
  assert.ok(foundBody.possibleMatch);
  assert.equal(foundBody.possibleMatch.confirmationCount, 0);
  const lostListing = foundBody.possibleMatch.listings.find((listing) => listing.type === 'lost');
  lostMatchId = lostListing.id;
  assert.equal(lostListing.ownerId, studentId);
  assert.ok(foundBody.possibleMatch.details.includes('brand'));
  assert.ok(foundBody.possibleMatch.details.includes('color'));

  const lostNotifications = await fetch(`${baseUrl}/api/matches`, { headers: { Cookie: studentCookie } });
  const lostMatches = await lostNotifications.json();
  assert.equal(lostMatches.length, 1);
  assert.equal(lostMatches[0].confirmedByCurrentUser, false);

  const unrelatedRegistration = await postJson('/api/auth/register', {
    name: 'Unrelated User',
    email: 'unrelated@example.edu',
    password: 'unrel1'
  });
  assert.equal(unrelatedRegistration.status, 201);
  unrelatedOwnerCookie = unrelatedRegistration.headers.get('set-cookie').split(';')[0];
  const unauthorized = await fetch(`${baseUrl}/api/matches/${foundBody.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: unrelatedOwnerCookie }
  });
  assert.equal(unauthorized.status, 403);

  const duplicateLost = await postJson('/api/items', {
    title: 'Moleskine notebook',
    description: 'Red cover and black elastic band',
    category: 'Books',
    type: 'lost',
    location: 'Lecture Hall 2',
    brand: 'Moleskine',
    color: 'red'
  }, studentCookie);
  assert.equal(duplicateLost.status, 201);
  const duplicateLostBody = await duplicateLost.json();
  assert.equal(duplicateLostBody.possibleMatch, null);

  const lostConfirmation = await fetch(`${baseUrl}/api/matches/${foundBody.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: studentCookie }
  });
  assert.equal(lostConfirmation.status, 200);
  const firstConfirmation = await lostConfirmation.json();
  assert.equal(firstConfirmation.resolved, false);
  assert.equal(firstConfirmation.confirmationCount, 1);

  const activeAfterOneConfirmation = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(activeAfterOneConfirmation.some((item) => item.id === lostMatchId));
  assert.ok(activeAfterOneConfirmation.some((item) => item.id === foundMatchId));
  assert.ok(activeAfterOneConfirmation.some((item) => item.id === duplicateLostBody.id));

  const duplicateConfirmation = await fetch(`${baseUrl}/api/matches/${foundBody.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: studentCookie }
  });
  assert.equal(duplicateConfirmation.status, 409);

  const foundConfirmation = await fetch(`${baseUrl}/api/matches/${foundBody.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: foundOwnerCookie }
  });
  assert.equal(foundConfirmation.status, 200);
  assert.equal((await foundConfirmation.json()).resolved, true);

  const activeAfterResolution = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(!activeAfterResolution.some((item) => [lostMatchId, foundMatchId].includes(item.id)));
  assert.ok(activeAfterResolution.some((item) => item.id === duplicateLostBody.id));

  const { readItems } = await import('../src/store.js');
  const history = await readItems();
  assert.equal(history.find((item) => item.id === lostMatchId).status, 'resolved');
  assert.equal(history.find((item) => item.id === foundMatchId).status, 'resolved');
  assert.ok(history.some((item) => item.id === lostMatchId));
  assert.ok(history.some((item) => item.id === foundMatchId));
  const ownHistory = await (await fetch(`${baseUrl}/api/my/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.equal(ownHistory.find((item) => item.id === lostMatchId).status, 'resolved');

  const matchesAfterResolution = await (await fetch(`${baseUrl}/api/matches`, {
    headers: { Cookie: foundOwnerCookie }
  })).json();
  assert.equal(matchesAfterResolution.length, 0);
});

test('enforces account roles and signs the student out', async () => {
  const studentResolvesOthersItem = await fetch(`${baseUrl}/api/items/sample-1/resolve`, {
    method: 'PATCH',
    headers: { Cookie: studentCookie }
  });
  assert.equal(studentResolvesOthersItem.status, 403);

  const ownItem = await fetch(`${baseUrl}/api/items/${studentItemId}/resolve`, {
    method: 'PATCH',
    headers: { Cookie: studentCookie }
  });
  assert.equal(ownItem.status, 409);

  const adminLogin = await postJson('/api/auth/login', {
    email: 'admin@example.edu',
    password: 'test-admin-password-123',
    role: 'admin'
  });
  assert.equal(adminLogin.status, 200);
  adminCookie = adminLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await adminLogin.json()).user.role, 'admin');

  const wrongRole = await postJson('/api/auth/login', {
    email: 'admin@example.edu',
    password: 'test-admin-password-123',
    role: 'student'
  });
  assert.equal(wrongRole.status, 401);

  const resolved = await fetch(`${baseUrl}/api/items/sample-1/resolve`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie }
  });
  assert.equal(resolved.status, 403);
  assert.equal((await fetch(`${baseUrl}/api/my/items`, {
    headers: { Cookie: adminCookie }
  })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/items/missing/resolve`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie }
  })).status, 404);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: studentCookie }
  });
  assert.equal(logout.status, 204);
  assert.equal((await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: studentCookie } })).json()).user, null);
  assert.equal((await fetch(`${baseUrl}/api/items`, { headers: { Cookie: studentCookie } })).status, 401);

  const studentLogin = await postJson('/api/auth/login', {
    email: 'student@example.edu',
    password: 'stud12',
    role: 'student'
  });
  assert.equal(studentLogin.status, 200);
  const newStudentCookie = studentLogin.headers.get('set-cookie').split(';')[0];
  studentCookie = newStudentCookie;
  assert.equal((await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: newStudentCookie } })).json()).user.id, studentId);
  assert.equal((await fetch(`${baseUrl}/api/items`, { headers: { Cookie: newStudentCookie } })).status, 200);
});

test('separates admin moderation from student listing and match actions', async () => {
  const { normalizeListingStatus } = await import('../src/store.js');
  assert.equal(normalizeListingStatus('REMOVED'), 'removed');
  assert.equal(normalizeListingStatus('RESOLVED'), 'resolved');
  assert.equal(normalizeListingStatus('PENDING_CONFIRMATION'), 'open');
  assert.equal(normalizeListingStatus('MATCHED'), 'open');

  const deniedDashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: studentCookie }
  });
  assert.equal(deniedDashboard.status, 403);

  const adminPost = await postJson('/api/items', {
    title: 'Admin test post',
    description: 'Must not be created as an admin',
    category: 'Other',
    type: 'found',
    location: 'Admin test'
  }, adminCookie);
  assert.equal(adminPost.status, 403);

  const lostPost = await postJson('/api/items', {
    title: 'Silver wireless earbuds',
    description: 'Silver charging case with a small blue mark',
    category: 'Electronics',
    type: 'lost',
    location: 'Main Library, second floor',
    brand: 'OnePlus',
    color: 'silver'
  }, studentCookie);
  assert.equal(lostPost.status, 201);
  const lost = await lostPost.json();
  const foundPost = await postJson('/api/items', {
    title: 'Silver wireless earbuds',
    description: 'Silver case with a blue mark, turned in at the library',
    category: 'Electronics',
    type: 'found',
    location: 'Main Library, second floor',
    brand: 'OnePlus',
    color: 'silver'
  }, foundOwnerCookie);
  assert.equal(foundPost.status, 201);
  const found = await foundPost.json();
  assert.ok(found.possibleMatch);

  const adminResolve = await fetch(`${baseUrl}/api/items/${lost.id}/resolve`, {
    method: 'PATCH',
    headers: { Cookie: adminCookie }
  });
  assert.equal(adminResolve.status, 403);
  const adminConfirm = await fetch(`${baseUrl}/api/matches/${found.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: adminCookie }
  });
  assert.equal(adminConfirm.status, 403);

  const studentReport = await postJson('/api/items/sample-1/reports', {
    reason: 'This listing contains inappropriate content.'
  }, studentCookie);
  assert.equal(studentReport.status, 201);
  const reportBody = await studentReport.json();
  const duplicateReport = await postJson('/api/items/sample-1/reports', {
    reason: 'Duplicate report for the same active post.'
  }, studentCookie);
  assert.equal(duplicateReport.status, 409);

  const dashboardResponse = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie }
  });
  assert.equal(dashboardResponse.status, 200);
  const dashboard = await dashboardResponse.json();
  const retainedListings = [...dashboard.activeListings, ...dashboard.resolvedHistory, ...dashboard.removedHistory];
  assert.equal(dashboard.stats.totalListings, retainedListings.length);
  assert.equal(dashboard.stats.activeLost, dashboard.activeListings.filter((item) => item.type === 'lost').length);
  assert.equal(dashboard.stats.activeFound, dashboard.activeListings.filter((item) => item.type === 'found').length);
  assert.ok(dashboard.stats.pendingMatches >= 1);
  assert.ok(dashboard.activeListings.every((item) => item.status === 'open'));
  assert.ok(dashboard.resolvedHistory.every((item) => item.status === 'resolved'));
  assert.ok(dashboard.removedHistory.every((item) => item.status === 'removed'));
  assert.ok(dashboard.reports.some((report) => report.status === 'pending' && report.itemId === 'sample-1'));
  assert.ok(dashboard.auditTrail.some((entry) => entry.action === 'report_submitted'));

  const studentDismiss = await fetch(`${baseUrl}/api/admin/reports/${dashboard.reports.find((report) => report.status === 'pending').id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ action: 'dismiss' })
  });
  assert.equal(studentDismiss.status, 403);
  const studentRemove = await fetch(`${baseUrl}/api/admin/items/sample-1/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: studentCookie },
    body: JSON.stringify({ reason: 'Unauthorized attempt.' })
  });
  assert.equal(studentRemove.status, 403);

  const dismiss = await fetch(`${baseUrl}/api/admin/reports/${reportBody.report.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ action: 'dismiss' })
  });
  assert.equal(dismiss.status, 200);
  const duplicateDismiss = await fetch(`${baseUrl}/api/admin/reports/${reportBody.report.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ action: 'dismiss' })
  });
  assert.equal(duplicateDismiss.status, 409);

  const removed = await fetch(`${baseUrl}/api/admin/items/sample-1/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ reason: 'Confirmed inappropriate campus content.' })
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).item.status, 'removed');
  const publicItems = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(!publicItems.some((item) => item.id === 'sample-1'));

  const updatedDashboard = await (await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie }
  })).json();
  assert.equal(updatedDashboard.removedHistory.find((item) => item.id === 'sample-1').status, 'removed');
  assert.ok(!updatedDashboard.activeListings.some((item) => item.id === 'sample-1'));
  assert.ok(updatedDashboard.auditTrail.some((entry) => entry.action === 'listing_removed' && entry.targetId === 'sample-1'));
  assert.ok(updatedDashboard.auditTrail.some((entry) => entry.action === 'report_dismissed'));

  const activeBeforeOwnerConfirmations = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(activeBeforeOwnerConfirmations.some((item) => item.id === lost.id));
  assert.ok(activeBeforeOwnerConfirmations.some((item) => item.id === found.id));

  const lostOwnerConfirmation = await fetch(`${baseUrl}/api/matches/${found.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: studentCookie }
  });
  assert.equal(lostOwnerConfirmation.status, 200);
  assert.equal((await lostOwnerConfirmation.json()).resolved, false);
  const stillActiveAfterOneConfirmation = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(stillActiveAfterOneConfirmation.some((item) => item.id === lost.id));
  assert.ok(stillActiveAfterOneConfirmation.some((item) => item.id === found.id));

  const foundOwnerConfirmation = await fetch(`${baseUrl}/api/matches/${found.possibleMatch.id}/confirm-returned`, {
    method: 'POST',
    headers: { Cookie: foundOwnerCookie }
  });
  assert.equal(foundOwnerConfirmation.status, 200);
  assert.equal((await foundOwnerConfirmation.json()).resolved, true);

  const activeAfterBothConfirmations = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: studentCookie }
  })).json();
  assert.ok(!activeAfterBothConfirmations.some((item) => item.id === lost.id || item.id === found.id));
  assert.ok(!activeAfterBothConfirmations.some((item) => item.title.toLowerCase().includes('silver wireless earbuds')));
  const historyAfterConfirmations = await (await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { Cookie: adminCookie }
  })).json();
  assert.ok(!historyAfterConfirmations.activeListings.some((item) => item.id === lost.id || item.id === found.id));
  assert.equal(historyAfterConfirmations.resolvedHistory.filter((item) => [lost.id, found.id].includes(item.id)).length, 2);
  assert.equal(historyAfterConfirmations.stats.pendingMatches, 0);
  assert.equal(historyAfterConfirmations.stats.activeLost, historyAfterConfirmations.activeListings.filter((item) => item.type === 'lost').length);
  assert.equal(historyAfterConfirmations.stats.activeFound, historyAfterConfirmations.activeListings.filter((item) => item.type === 'found').length);

  const relogin = await postJson('/api/auth/login', {
    email: 'student@example.edu',
    password: 'stud12',
    role: 'student'
  });
  assert.equal(relogin.status, 200);
  const reloginCookie = relogin.headers.get('set-cookie').split(';')[0];
  const activeAfterRelogin = await (await fetch(`${baseUrl}/api/items`, {
    headers: { Cookie: reloginCookie }
  })).json();
  assert.ok(!activeAfterRelogin.some((item) => item.id === lost.id || item.id === found.id));
  const { readItems } = await import('../src/store.js');
  const persistedListings = await readItems();
  assert.equal(persistedListings.find((item) => item.id === lost.id).status, 'resolved');
  assert.equal(persistedListings.find((item) => item.id === found.id).status, 'resolved');

  const itemsFile = path.join(dataDirectory, 'items.json');
  const rawListings = JSON.parse(await readFile(itemsFile, 'utf8'));
  rawListings.find((item) => item.id === lost.id).status = 'RESOLVED';
  rawListings.find((item) => item.id === 'sample-1').status = 'REMOVED';
  await writeFile(itemsFile, JSON.stringify(rawListings));
  const { normalizePersistedListingStatuses } = await import('../src/store.js');
  await normalizePersistedListingStatuses();
  const migratedListings = JSON.parse(await readFile(itemsFile, 'utf8'));
  assert.equal(migratedListings.find((item) => item.id === lost.id).status, 'resolved');
  assert.equal(migratedListings.find((item) => item.id === 'sample-1').status, 'removed');
});
