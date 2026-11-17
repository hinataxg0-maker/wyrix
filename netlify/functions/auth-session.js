const auth = require('./_auth');

exports.handler = async (event) => {
  const session = auth.decode(auth.getCookie(event, 'wyrix_session'));
  const authenticated = typeof session?.id === 'string' && /^\d{17,20}$/.test(session.id);
  const owner = authenticated && session.id === auth.ownerId;
  const response = { authenticated, owner };

  if (owner) {
    response.panel = {
      heading: 'Welcome, Owner.',
      message: 'Protected administrative features will appear here once their server-side APIs are implemented.',
    };
  }

  return auth.response(200, response, { 'Content-Type': 'application/json' });
};
