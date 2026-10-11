import { app } from './app.js';
import { initializeAdmin } from './auth-store.js';
import { normalizePersistedListingStatuses } from './store.js';

const port = Number(process.env.PORT || 3000);
await initializeAdmin();
await normalizePersistedListingStatuses();
app.listen(port, '0.0.0.0', () => {
  console.log(`Campus Find API listening on port ${port}`);
});
