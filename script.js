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
    if (session.authenticated) mountLibrary(session);
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
      mountAdmin(content);
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



const ownerApi = '/.netlify/functions/owner-workspace';

async function workspaceRequest(query = '', input) {
  const response = await fetch(ownerApi + query, input ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha ao acessar o painel.');
  return data;
}

function addRow(parent, text) {
  const row = document.createElement('li');
  row.textContent = text + ' ';
  parent.append(row);
  return row;
}

function addAction(row, label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', action);
  row.append(button, ' ');
}

function addDownload(row, id) {
  const link = document.createElement('a');
  link.href = ownerApi + '?view=download&id=' + encodeURIComponent(id);
  link.textContent = 'Baixar';
  row.append(link, ' ');
}

function mountAdmin(content) {
  const panel = document.createElement('div');
  panel.innerHTML = '<h3>Scripts e versões</h3><form data-upload><label>Projeto <select name="project"></select></label> <label>Arquivo <input type="file" name="script" accept=".lua,.luau" required></label> <button>Enviar versão</button></form><ul data-scripts></ul>' +
    '<h3>Licenças</h3><form data-issue><label>Discord ID (opcional) <input name="user" inputmode="numeric" pattern="[0-9]{17,20}"></label> <button>Gerar key</button></form><p data-key></p><ul data-licenses></ul>' +
    '<h3>Usuários vinculados</h3><ul data-users></ul><h3>Auditoria</h3><ul data-audit></ul><p data-status role="status"></p>';
  content.append(panel);
  const select = panel.querySelector('select');
  const status = panel.querySelector('[data-status]');
  const keyOutput = panel.querySelector('[data-key]');
  const render = async () => {
    const data = await workspaceRequest();
    select.replaceChildren(new Option('Novo script', ''));
    const projects = new Set();
    const scripts = panel.querySelector('[data-scripts]');
    scripts.replaceChildren();
    for (const script of data.scripts) {
      if (script.state === 'removed') continue;
      if (!projects.has(script.project)) {
        projects.add(script.project);
        select.add(new Option(script.name, script.project));
      }
      const state = script.state === 'published' ? 'publicada' : 'rascunho';
      const row = addRow(scripts, script.name + ' · v' + script.version + ' · ' + state);
      addDownload(row, script.id);
      if (script.state === 'published') addAction(row, 'Despublicar', () => run(() => ({ action: 'unpublish', id: script.id })));
      else addAction(row, 'Publicar', () => run(() => ({ action: 'publish', id: script.id })));
      addAction(row, 'Remover', () => {
        if (window.confirm('Remover definitivamente o arquivo desta versão?')) run(() => ({ action: 'remove', id: script.id }));
      });
    }
    const licenses = panel.querySelector('[data-licenses]');
    const users = panel.querySelector('[data-users]');
    licenses.replaceChildren();
    users.replaceChildren();
    const groups = new Map();
    for (const license of data.licenses) {
      const state = license.revokedAt ? 'revogada' : license.redeemedAt ? 'ativa' : 'pendente';
      const row = addRow(licenses, license.id + ' · ' + (license.user || 'sem vínculo') + ' · ' + state);
      if (!license.revokedAt) addAction(row, 'Revogar', () => {
        if (window.confirm('Revogar esta licença?')) run(() => ({ action: 'revoke', id: license.id }));
      });
      if (license.user) {
        const counts = groups.get(license.user) || [];
        counts.push(state);
        groups.set(license.user, counts);
      }
    }
    for (const [id, states] of groups) {
      addRow(users, id + ' · ' + states.length + ' licença(s), ' + states.filter(state => state === 'ativa').length + ' ativa(s)');
    }
    const audit = panel.querySelector('[data-audit]');
    audit.replaceChildren();
    for (const record of data.audit) {
      addRow(audit, new Date(record.at).toLocaleString() + ' · ' + record.action + ' · ' + record.actor + ' · ' + record.target);
    }
  };

  let busy = false;
  async function run(input) {
    if (busy) return;
    busy = true;
    status.textContent = 'Processando…';
    try {
      const result = await workspaceRequest('', await input());
      if (result.key) keyOutput.textContent = 'Copie agora. A key é exibida uma vez: ' + result.key;
      status.textContent = 'Operação concluída.';
      await render();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
    }
  }

  panel.querySelector('[data-upload]').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.script.files[0];
    const project = select.value;
    run(async () => {
      if (!file || file.size > 48 * 1024) throw new Error('Selecione um arquivo de até 48 KB.');
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      return { action: 'upload', name: file.name, project, source };
    });
  });
  panel.querySelector('[data-issue]').addEventListener('submit', event => {
    event.preventDefault();
    const user = event.currentTarget.elements.user.value.trim();
    run(() => ({ action: 'issue', user }));
  });
  render().catch(error => { status.textContent = error.message; });
}

function mountLibrary(session) {
  const section = document.getElementById('redeem');
  const placeholder = section.querySelector('input');
  const note = section.querySelector('p');
  const form = document.createElement('form');
  form.innerHTML = '<label>Key WYRIX <input name="key" required autocomplete="off"></label> <button>Ativar</button>';
  placeholder.replaceWith(form);
  const scripts = document.createElement('ul');
  section.append(scripts);
  async function render() {
    const data = await workspaceRequest('?view=library');
    note.textContent = data.licensed || session.owner ? 'Versões disponíveis para download.' : 'Ative uma key para acessar os scripts publicados.';
    scripts.replaceChildren();
    for (const script of data.scripts) addDownload(addRow(scripts, script.name + ' · v' + script.version), script.id);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await workspaceRequest('', { action: 'redeem', key: form.elements.key.value.trim() });
      form.reset();
      await render();
    } catch (error) {
      note.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  render().catch(error => { note.textContent = error.message; });
}

loadOwnerPanel();
