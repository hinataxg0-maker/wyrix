const returnUrl = new URL(window.location.href);
if (returnUrl.hash === '#owner' && returnUrl.searchParams.has('code') && returnUrl.searchParams.has('state')) {
  for (const parameter of ['code', 'state', 'iss']) {
    returnUrl.searchParams.delete(parameter);
  }
  window.history.replaceState(window.history.state, '', returnUrl.pathname + returnUrl.search + returnUrl.hash);
}

async function loadOwnerPanel() {
  const status = document.getElementById('owner-status');
  const content = document.getElementById('owner-content');
  const login = document.getElementById('owner-login');

  login.style.display = 'none';

  try {
    const response = await fetch('/.netlify/functions/auth-session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Session lookup failed');

    const session = await response.json();
    if (session.owner && session.panel) {
      const heading = document.createElement('h3');
      heading.textContent = session.panel.heading;
      const message = document.createElement('p');
      message.textContent = session.panel.message;
      const logout = document.createElement('a');
      logout.href = '/.netlify/functions/auth-logout';
      logout.textContent = 'Sign out';
      content.replaceChildren(heading, message, logout);
      content.hidden = false;
      status.textContent = 'Owner identity verified.';
      return;
    }

    status.textContent = session.authenticated
      ? 'This Discord account is not authorized as Owner.'
      : 'Sign in with your authorized Discord account.';
  } catch {
    status.textContent = 'Could not check your Discord session. Try signing in again.';
  }

  login.hidden = false;
  login.style.removeProperty('display');
}

loadOwnerPanel();
