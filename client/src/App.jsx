import { useCallback, useEffect, useMemo, useState } from 'react';

const categories = ['All items', 'Electronics', 'Keys', 'Bags', 'Books', 'Clothing', 'Other'];

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

async function parseApiResponse(response) {
  if (response.headers.get('content-type')?.includes('application/json')) {
    return response.json();
  }
  if (!response.ok) {
    throw new Error('The server is restarting or unavailable. Please wait a moment and try again.');
  }
  throw new Error('The server returned an unexpected response. Please try again.');
}

function LoginPage() {
  const [role, setRole] = useState('student');
  const [mode, setMode] = useState('login');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitAuth(event) {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    try {
      const response = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? payload : { ...payload, role })
      });
      const result = await parseApiResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not sign in.');
      window.location.assign(result.user.role === 'admin' ? '/admin' : '/');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Campus Find home">
          <span className="brand-mark">cf</span>
          <span>campus<span className="brand-light">find</span></span>
        </a>
        <span className="campus-label">Lost &amp; Found community</span>
      </header>
      <section className="login-layout">
        <div className="login-intro">
          <p className="eyebrow"><span className="live-dot" /> YOUR CAMPUS, CONNECTED</p>
          <h1>Good things<br />find their <span>way back.</span></h1>
          <p className="hero-description">Sign in to be part of a campus community that looks out for what matters.</p>
          <div className="login-art" role="img" aria-label="Illustration of campus belongings ready to be reunited">
            <div className="login-art-sun" />
            <div className="login-art-book">FIELD<br />NOTES</div>
            <div className="login-art-bag"><span>YOUR<br />CAMPUS</span></div>
            <span className="login-art-spark">✳</span>
            <span className="login-art-caption">A little lost, never alone.</span>
          </div>
        </div>
        <div className="login-card">
          <p className="eyebrow">WELCOME TO CAMPUS FIND</p>
          <h2>{mode === 'register' ? 'Create your account' : 'Sign in to your account'}</h2>
          <p className="login-subtitle">{mode === 'register' ? 'Create a student account to join the board.' : 'Choose how you want to continue.'}</p>
          <div className="role-picker" role="group" aria-label="Choose account type">
            <button type="button" className={role === 'student' ? 'role-option selected' : 'role-option'} aria-pressed={role === 'student'} onClick={() => { setRole('student'); setMode('login'); setMessage(''); }}>
              <span className="role-icon">♧</span><span><strong>Student</strong><small>Find or report an item</small></span>
            </button>
            <button type="button" className={role === 'admin' ? 'role-option selected' : 'role-option'} aria-pressed={role === 'admin'} onClick={() => { setRole('admin'); setMode('login'); setMessage(''); }}>
              <span className="role-icon">⌘</span><span><strong>Admin</strong><small>Manage campus listings</small></span>
            </button>
          </div>
          <form className="login-form" onSubmit={submitAuth}>
            {mode === 'register' && <>
              <label htmlFor="login-name">Your name</label>
              <input id="login-name" name="name" type="text" autoComplete="name" maxLength="80" placeholder="Your full name" required />
            </>}
            <label htmlFor="login-email">{role === 'admin' ? 'Administrator email' : 'College email'}</label>
            <input id="login-email" name="email" type="email" autoComplete="username" placeholder={role === 'admin' ? 'admin@college.edu' : 'you@college.edu'} required />
            <div className="password-label"><label htmlFor="login-password">Password</label><span>{mode === 'register' ? '6+ characters' : 'Required'}</span></div>
            <div className="password-input">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 6 : undefined} maxLength="128" placeholder="Enter your password" required />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button>
            </div>
            {role === 'admin' && <p className="admin-note">Admin accounts are provisioned by the campus system administrator.</p>}
            {message && <p className="login-notice" role="status">{message}</p>}
            <button className="button button-dark login-submit" type="submit" disabled={submitting}>
              {submitting ? 'Please wait...' : mode === 'register' ? 'Create student account' : `Continue as ${role === 'admin' ? 'admin' : 'student'}`} <span>→</span>
            </button>
          </form>
          {role === 'student' && (
            <p className="login-prototype">
              {mode === 'register' ? 'Already have an account?' : 'New to Campus Find?'}{' '}
              <button type="button" onClick={() => { setMode((current) => current === 'login' ? 'register' : 'login'); setMessage(''); }}>
                {mode === 'register' ? 'Login' : 'Sign Up'}
              </button>
            </p>
          )}
          <p className="login-board-link">Sign in to access the private campus board.</p>
        </div>
      </section>
      <footer className="login-footer"><span>© Campus Find</span><span>Made for campus. Built to bring things back.</span><a href="/">Lost &amp; Found board ↗</a></footer>
    </main>
  );
}

function LostFoundBoard({ user }) {
  const [items, setItems] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [category, setCategory] = useState('All items');
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState([]);
  const [confirmingMatchId, setConfirmingMatchId] = useState(null);

  const loadItems = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('Could not load campus listings.');
      setItems(await response.json());
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatches = useCallback(async () => {
    try {
      const response = await fetch('/api/matches');
      if (!response.ok) throw new Error('Could not load possible matches.');
      setMatches(await response.json());
    } catch (error) {
      setMessage(error.message);
    }
  }, []);

  const loadMyItems = useCallback(async () => {
    try {
      const response = await fetch('/api/my/items');
      if (!response.ok) throw new Error('Could not load your listings.');
      setMyItems(await response.json());
    } catch (error) {
      setMessage(error.message);
    }
  }, []);

  useEffect(() => {
    loadItems();
    loadMyItems();
  }, [loadItems, loadMyItems]);

  useEffect(() => {
    loadMatches();
    const refresh = window.setInterval(() => {
      loadItems(false);
      loadMatches();
      loadMyItems();
    }, 5000);
    return () => window.clearInterval(refresh);
  }, [loadItems, loadMatches, loadMyItems]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const matchesCategory = category === 'All items' || item.category === category;
    const matchesKind = kind === 'all' || item.type === kind;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [item.title, item.description, item.location, item.category, item.brand, item.color]
      .some((field) => (field || '').toLowerCase().includes(query));
    return matchesCategory && matchesKind && matchesSearch;
  }), [items, category, kind, search]);

  async function submitItem(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const payload = new FormData(formElement);
    const imageFile = payload.get('image');
    try {
      payload.delete('image');
      if (imageFile?.size) {
        if (!imageFile.type.startsWith('image/')) throw new Error('Choose an image file.');
        if (imageFile.size > 2 * 1024 * 1024) throw new Error('Item photos must be 2 MB or smaller.');
        const resizedImage = await resizeItemImage(imageFile);
        payload.set('image', resizedImage);
      } else {
        payload.delete('image');
      }
      const response = await fetch('/api/items', { method: 'POST', body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit your listing.');
      formElement.reset();
      setShowForm(false);
      setMessage(result.possibleMatch
        ? 'Your listing is posted. A possible match was found; both listing owners must confirm the return.'
        : 'Your listing has been posted.');
      await Promise.all([loadItems(), loadMyItems()]);
      await loadMatches();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function resizeItemImage(file) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      let scale = Math.min(1, 1200 / image.width, 1200 / image.height);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not process this image.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', Math.max(0.5, 0.82 - attempt * 0.08)));
        if (!blob) throw new Error('Could not process this image.');
        if (blob.size <= 1024 * 1024) return new File([blob], 'item-photo.jpg', { type: 'image/jpeg' });
        scale *= 0.75;
      }
      throw new Error('This photo could not be compressed under 1 MB. Choose a smaller image.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function resolveItem(id) {
    try {
      const response = await fetch(`/api/items/${id}/resolve`, { method: 'PATCH' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update this listing.');
      await Promise.all([loadItems(false), loadMyItems()]);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function confirmReturned(matchId) {
    setConfirmingMatchId(matchId);
    try {
      const response = await fetch(`/api/matches/${matchId}/confirm-returned`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not confirm this return.');
      setMessage(result.resolved
        ? 'Both owners confirmed. The matched listings have been resolved.'
        : 'Your confirmation is saved. The other listing owner must also confirm.');
      await Promise.all([loadItems(false), loadMatches()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setConfirmingMatchId(null);
    }
  }

  async function reportListing(id) {
    const reason = window.prompt('Why should this listing be reviewed?');
    if (reason === null) return;
    try {
      const response = await fetch(`/api/items/${id}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not report this listing.');
      setMessage('Your report was sent to the campus administrators.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out.');
      setItems([]);
      setMyItems([]);
      setMatches([]);
      window.location.replace('/login');
    } catch (error) {
      setMessage(error.message);
    }
  }

  const openCount = items.filter((item) => item.status === 'open').length;
  const canResolve = (item) => item.ownerId === user.id && item.status === 'open' &&
    !matches.some((match) => match.listings.some((listing) => listing.id === item.id));

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Campus Find home">
          <span className="brand-mark">cf</span>
          <span>campus<span className="brand-light">find</span></span>
        </a>
        <div className="topbar-actions">
          <a className="campus-label" href="#listings">Campus community board <span>↗</span></a>
          {user ? (
            <div className="account-menu">
              <span className="account-label">{user.name}</span>
              <button className="login-link" onClick={logout}>Sign out <span>→</span></button>
            </div>
          ) : <a className="login-link" href="/login">Sign in <span>→</span></a>}
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="live-dot" /> YOUR CAMPUS, CONNECTED</p>
          <h1>Lost something?<br /><span>Found a little hope.</span></h1>
          <p className="hero-description">The easiest way to reunite campus belongings with the people who miss them.</p>
          {user.role === 'student' ? (
            <button className="button button-dark" onClick={() => setShowForm((value) => !value)}>
              {showForm ? 'Close form' : '＋ Post a listing'}
            </button>
          ) : null}
        </div>
        <div className="hero-art" aria-label="Illustration of a backpack and lost belongings" role="img">
          <div className="sun-shape" />
          <div className="art-note note-one">FOUND<br />TOGETHER</div>
          <div className="art-book"><span>FIELD<br />NOTES</span></div>
          <div className="art-bag"><div className="bag-handle" /><div className="bag-pocket" /><span>YOUR<br />CAMPUS</span></div>
          <div className="art-key">✳</div>
          <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✳</span>
          <div className="art-caption">A little lost, never alone.</div>
        </div>
      </section>

      <section className="stats-row" aria-label="Listing summary">
        <div><strong>{openCount.toString().padStart(2, '0')}</strong><span>items looking for home</span></div>
        <div className="stats-divider" />
        <div><strong>01</strong><span>campus, one community</span></div>
        <div className="community-note"><span className="avatar-stack"><i>J</i><i>M</i><i>A</i></span> Good things find their way back.</div>
      </section>

      {showForm && (
        <section className="form-panel" aria-labelledby="form-heading">
          <div className="section-heading">
            <div><p className="eyebrow">HELP THE COMMUNITY</p><h2 id="form-heading">Post a listing</h2></div>
            <button className="close-button" onClick={() => setShowForm(false)} aria-label="Close form">×</button>
          </div>
          <form className="listing-form" onSubmit={submitItem}>
            <label>Item name<input name="title" required maxLength="80" placeholder="e.g. Blue water bottle" /></label>
            <label>Type<select name="type" required><option value="lost">I lost this</option><option value="found">I found this</option></select></label>
            <label>Category<select name="category" required>{categories.slice(1).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Where was it seen?<input name="location" required maxLength="100" placeholder="e.g. Library, second floor" /></label>
            <label>Brand <span className="upload-hint">Optional</span><input name="brand" maxLength="80" placeholder="e.g. Moleskine" /></label>
            <label>Color <span className="upload-hint">Optional</span><input name="color" maxLength="40" placeholder="e.g. Red" /></label>
            <label className="field-wide">Description<textarea name="description" required maxLength="500" rows="3" placeholder="Add a few details to help identify it..." /></label>
            <label className="field-wide">Item photo <span className="upload-hint">Optional · JPG, PNG, GIF, or WebP · max 2 MB (compressed before upload)</span><input name="image" type="file" accept="image/jpeg,image/png,image/gif,image/webp" /></label>
            <p className="contact-note field-wide">Your account email ({user.email}) will be shown to people contacting you.</p>
            <button className="button button-dark field-wide" type="submit">Publish listing <span>→</span></button>
          </form>
        </section>
      )}

      <section className="listings user-listings" aria-labelledby="my-listings-heading">
        <div className="section-heading">
          <div><p className="eyebrow">YOUR ACCOUNT</p><h2 id="my-listings-heading">Your listings</h2></div>
          <p className="listing-count">{myItems.length} TOTAL <span>↘</span></p>
        </div>
        {myItems.length === 0 ? (
          <p className="empty-state">You have not posted any listings yet.</p>
        ) : (
          <div className="item-grid">
            {myItems.map((item) => (
              <article className={`item-card ${item.status === 'resolved' ? 'resolved' : ''}`} key={item.id}>
                <div className="card-top">
                  <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? 'LOST ITEM' : 'FOUND ITEM'}</span>
                  <span className="resolved-label">{item.status === 'open' ? 'ACTIVE' : item.status.toUpperCase()}</span>
                </div>
                <h3>{item.title}</h3>
                <p className="item-description">{item.description}</p>
                <div className="card-location"><span>⌖</span> {item.location}</div>
                <div className="card-footer">
                  <span>{formatDate(item.createdAt)}</span>
                  {canResolve(item)
                    ? <button onClick={() => resolveItem(item.id)}>Mark resolved ✓</button>
                    : item.status === 'resolved' ? <span className="resolved-label">REUNITED ✓</span> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="listings" className="listings">
        <div className="section-heading">
          <div><p className="eyebrow">THE CAMPUS BOARD</p><h2>Things find their way.</h2></div>
          <p className="listing-count">{filteredItems.length} LISTINGS <span>↘</span></p>
        </div>

        <div className="toolbar">
          <div className="filter-tabs" aria-label="Filter by listing type">
            {[['all', 'Everything'], ['lost', 'Lost'], ['found', 'Found']].map(([value, label]) => (
              <button key={value} className={kind === value ? 'filter-tab active' : 'filter-tab'} onClick={() => setKind(value)}>{label}</button>
            ))}
          </div>
          <div className="search-wrap"><span>⌕</span><input aria-label="Search listings" placeholder="Search items..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        </div>
        <div className="category-row">
          {categories.map((value) => <button key={value} className={category === value ? 'category-chip selected' : 'category-chip'} onClick={() => setCategory(value)}>{value}</button>)}
        </div>

        {message && <p className="notice" role="status">{message}</p>}
        {matches.length > 0 && (
          <section className="match-notifications" aria-label="Possible item matches">
            <h3>Possible matches</h3>
            <p>These details look similar, but the listings stay active until both owners confirm the item was returned.</p>
            {matches.map((match) => {
              const ownListing = match.listings.find((item) => item.ownerId === user?.id);
              const otherListing = match.listings.find((item) => item.ownerId !== user?.id);
              return (
                <article className="match-notice" key={match.id}>
                  <div>
                    <strong>{ownListing?.title} ↔ {otherListing?.title}</strong>
                    <span>Possible match based on {match.details.join(', ')}. {match.confirmationCount} of 2 owners confirmed.</span>
                  </div>
                  {match.confirmedByCurrentUser
                    ? <span className="match-confirmed">Your confirmation is recorded</span>
                    : <button className="button button-dark" disabled={confirmingMatchId === match.id} onClick={() => confirmReturned(match.id)}>
                        {confirmingMatchId === match.id ? 'Saving…' : 'Item Returned Successfully'}
                      </button>}
                </article>
              );
            })}
          </section>
        )}
        {loading ? <p className="empty-state">Loading campus listings...</p> : filteredItems.length === 0 ? (
          <div className="empty-state"><span>✳</span><h3>No listings just yet.</h3><p>Try another filter or post the first one.</p></div>
        ) : (
          <div className="item-grid">
            {filteredItems.map((item) => (
              <article className={`item-card ${item.status === 'resolved' ? 'resolved' : ''}`} key={item.id}>
                <div className="card-top"><span className={`type-pill ${item.type}`}>{item.type === 'lost' ? 'LOST ITEM' : 'FOUND ITEM'}</span><span className="card-date">{formatDate(item.createdAt)}</span></div>
                {item.image ? <img className="item-photo" src={item.image} alt={item.title} loading="lazy" /> : <div className="item-icon">{item.category === 'Electronics' ? '⌁' : item.category === 'Keys' ? '⚿' : item.category === 'Books' ? '▤' : item.category === 'Bags' ? '▱' : '✳'}</div>}
                <h3>{item.title}</h3>
                <p className="item-description">{item.description}</p>
                <div className="card-location"><span>⌖</span> {item.location}</div>
                <div className="card-footer">
                  <a href={`mailto:${encodeURIComponent(item.contact)}?subject=${encodeURIComponent(`Campus Find: ${item.title}`)}`}>Contact poster <span>↗</span></a>
                  {item.status === 'open' && canResolve(item) ? <button onClick={() => resolveItem(item.id)}>Mark resolved ✓</button> : null}
                  {item.status === 'open' && item.ownerId !== user.id
                    ? <button onClick={() => reportListing(item.id)}>Report</button>
                    : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer><a className="brand" href="#"><span className="brand-mark">cf</span><span>campus<span className="brand-light">find</span></span></a><span>Made for campus. Built to bring things back.</span><a href="/api/health">System status ↗</a></footer>
    </main>
  );
}

function AdminDashboard({ user }) {
  const [dashboard, setDashboard] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/dashboard');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load the admin dashboard.');
      setDashboard(result);
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const refresh = window.setInterval(loadDashboard, 5000);
    return () => window.clearInterval(refresh);
  }, [loadDashboard]);

  async function dismissReport(id) {
    try {
      const response = await fetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not review this report.');
      setMessage('Report dismissed and recorded in the audit trail.');
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeListing(id) {
    const reason = window.prompt('Enter the moderation reason. This will be saved in the audit trail.');
    if (reason === null) return;
    try {
      const response = await fetch(`/api/admin/items/${id}/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove this listing.');
      setMessage('Listing removed from active posts and recorded in the audit trail.');
      await loadDashboard();
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out.');
      setDashboard(null);
      window.location.replace('/login');
    } catch (error) {
      setMessage(error.message);
    }
  }

  const pendingReports = dashboard?.reports.filter((report) => report.status === 'pending') ?? [];
  const stats = dashboard?.stats ?? {
    totalListings: 0,
    activeLost: 0,
    activeFound: 0,
    pendingMatches: 0,
    resolvedItems: 0
  };
  const statCards = [
    ['Total listings', stats.totalListings],
    ['Active lost', stats.activeLost],
    ['Active found', stats.activeFound],
    ['Pending matches', stats.pendingMatches],
    ['Resolved items', stats.resolvedItems]
  ];

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="/admin" aria-label="Campus Find admin dashboard">
          <span className="brand-mark">cf</span>
          <span>campus<span className="brand-light">find</span></span>
        </a>
        <div className="topbar-actions">
          <span className="campus-label">Administrator dashboard</span>
          <div className="account-menu">
            <span className="account-label">{user.name}<small>ADMIN</small></span>
            <button className="login-link" onClick={logout}>Sign out <span>→</span></button>
          </div>
        </div>
      </header>

      <section className="admin-heading">
        <p className="eyebrow"><span className="live-dot" /> CAMPUS FIND · ADMINISTRATION</p>
        <h1>Admin dashboard</h1>
        <p>Review campus activity, reported posts, and possible matches. Moderation does not confirm item returns.</p>
      </section>

      {message && <p className="notice" role="status">{message}</p>}
      {loading && !dashboard ? <p className="empty-state">Loading admin dashboard...</p> : null}

      <section className="admin-stats" aria-label="Live listing statistics">
        {statCards.map(([label, value]) => (
          <article className="admin-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div><p className="eyebrow">OWNER CONFIRMATION REQUIRED</p><h2>Possible Lost–Found matches</h2></div>
          <span className="listing-count">{dashboard?.pendingMatches.length ?? 0} PENDING</span>
        </div>
        {(dashboard?.pendingMatches.length ?? 0) === 0 ? (
          <p className="empty-state">There are no pending possible matches.</p>
        ) : (
          <div className="admin-match-list">
            {dashboard.pendingMatches.map((match) => (
              <article className="admin-match" key={match.id}>
                <div>
                  <strong>{match.listings.map((item) => `${item.type}: ${item.title}`).join(' ↔ ')}</strong>
                  <span>Suggested by {match.details.join(', ')} · {match.confirmationCount} of 2 owners confirmed</span>
                </div>
                <span className="match-confirmed">Admin review only — cannot confirm for owners</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div><p className="eyebrow">COMMUNITY REPORTS</p><h2>Reported posts</h2></div>
          <span className="listing-count">{pendingReports.length} TO REVIEW</span>
        </div>
        {pendingReports.length === 0 ? (
          <p className="empty-state">No reported posts need review.</p>
        ) : (
          <div className="admin-review-list">
            {pendingReports.map((report) => (
              <article className="admin-review" key={report.id}>
                <div>
                  <strong>{report.listing?.title ?? 'Listing unavailable'}</strong>
                  <span>Reported by {report.reporterName} · {formatDate(report.createdAt)}</span>
                  <p>{report.reason}</p>
                </div>
                <div className="admin-actions">
                  <button className="button button-light" onClick={() => dismissReport(report.id)}>Dismiss report</button>
                  {report.listing?.status !== 'removed' && report.listing && (
                    <button className="button button-dark" onClick={() => removeListing(report.itemId)}>Remove listing</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div><p className="eyebrow">ACTIVE CAMPUS CONTENT</p><h2>Active listings</h2></div>
          <span className="listing-count">{dashboard?.activeListings.length ?? 0} ACTIVE</span>
        </div>
        {(dashboard?.activeListings.length ?? 0) === 0 ? <p className="empty-state">No active listings.</p> : (
          <div className="item-grid">
            {dashboard.activeListings.map((item) => (
              <article className={`item-card ${item.status === 'resolved' ? 'resolved' : ''}`} key={item.id}>
                <div className="card-top">
                  <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? 'LOST ITEM' : 'FOUND ITEM'}</span>
                  <span className="resolved-label">ACTIVE</span>
                </div>
                {item.image ? <img className="item-photo" src={item.image} alt={item.title} loading="lazy" /> : null}
                <h3>{item.title}</h3>
                <p className="item-description">{item.description}</p>
                <div className="card-location"><span>⌖</span> {item.location}</div>
                <div className="card-footer">
                  <span>{item.contact}</span>
                  <button onClick={() => removeListing(item.id)}>Remove post</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="resolved-history-heading">
        <div className="section-heading">
          <div><p className="eyebrow">RETAINED RECORDS</p><h2 id="resolved-history-heading">Resolved / History</h2></div>
          <span className="listing-count">{dashboard?.resolvedHistory.length ?? 0} RESOLVED</span>
        </div>
        {(dashboard?.resolvedHistory.length ?? 0) === 0 ? <p className="empty-state">No resolved listings yet.</p> : (
          <div className="item-grid">
            {dashboard.resolvedHistory.map((item) => (
              <article className="item-card resolved" key={item.id}>
                <div className="card-top">
                  <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? 'LOST ITEM' : 'FOUND ITEM'}</span>
                  <span className="resolved-label">RESOLVED</span>
                </div>
                <h3>{item.title}</h3>
                <p className="item-description">{item.description}</p>
                <div className="card-location"><span>⌖</span> {item.location}</div>
                <div className="card-footer"><span>{item.contact}</span><span>{item.resolvedAt ? formatDate(item.resolvedAt) : ''}</span></div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="removed-history-heading">
        <div className="section-heading">
          <div><p className="eyebrow">MODERATED RECORDS</p><h2 id="removed-history-heading">Removed listings</h2></div>
          <span className="listing-count">{dashboard?.removedHistory.length ?? 0} REMOVED</span>
        </div>
        {(dashboard?.removedHistory.length ?? 0) === 0 ? <p className="empty-state">No listings have been removed.</p> : (
          <div className="item-grid">
            {dashboard.removedHistory.map((item) => (
              <article className="item-card" key={item.id}>
                <div className="card-top">
                  <span className={`type-pill ${item.type}`}>{item.type === 'lost' ? 'LOST ITEM' : 'FOUND ITEM'}</span>
                  <span className="resolved-label removed-label">REMOVED</span>
                </div>
                <h3>{item.title}</h3>
                <p className="item-description">{item.description}</p>
                <div className="card-location"><span>⌖</span> {item.location}</div>
                <div className="card-footer">
                  <span>{item.contact}</span>
                  <span title={item.removalReason}>{item.removalReason || 'Moderated post'}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="section-heading">
          <div><p className="eyebrow">MODERATION HISTORY</p><h2>Audit trail</h2></div>
          <span className="listing-count">LATEST {dashboard?.auditTrail.length ?? 0}</span>
        </div>
        {(dashboard?.auditTrail.length ?? 0) === 0 ? <p className="empty-state">Moderation and report actions will appear here.</p> : (
          <ol className="audit-list">
            {dashboard.auditTrail.map((entry) => (
              <li key={entry.id}>
                <div><strong>{entry.action.replaceAll('_', ' ')}</strong><span>{entry.actorName} · {formatDate(entry.createdAt)}</span></div>
                <p>{entry.details.reason ?? entry.details.reportId ?? entry.targetId}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer><a className="brand" href="/admin"><span className="brand-mark">cf</span><span>campus<span className="brand-light">find</span></span></a><span>Campus Find administration</span><a href="/api/health">System status ↗</a></footer>
    </main>
  );
}

export default function App() {
  const [authState, setAuthState] = useState('checking');
  const [authError, setAuthError] = useState('');
  const [sessionUser, setSessionUser] = useState(null);

  const verifySession = useCallback(async () => {
    setAuthState('checking');
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not verify your sign-in. Please try again.');
      const result = await response.json();
      if (result.user) {
        setSessionUser(result.user);
        setAuthState('authenticated');
        setAuthError('');
        const expectedPath = result.user.role === 'admin' ? '/admin' : '/';
        if (window.location.pathname !== expectedPath) window.location.replace(expectedPath);
      } else {
        setSessionUser(null);
        setAuthState('unauthenticated');
        if (window.location.pathname !== '/login') window.location.replace('/login');
      }
    } catch (error) {
      setAuthError(error.message);
      setAuthState('error');
    }
  }, []);

  useEffect(() => {
    verifySession();
    const handlePageShow = (event) => {
      if (event.persisted) verifySession();
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [verifySession]);

  if (authState === 'checking') {
    return <main className="login-shell"><p className="empty-state">Checking your sign-in...</p></main>;
  }
  if (authState === 'error') {
    return <main className="login-shell"><p className="login-notice" role="alert">{authError}</p><button className="button button-dark" onClick={verifySession}>Try again</button></main>;
  }
  if (authState === 'unauthenticated') return <LoginPage />;
  if (sessionUser.role === 'admin') return <AdminDashboard user={sessionUser} />;
  return <LostFoundBoard user={sessionUser} />;
}
