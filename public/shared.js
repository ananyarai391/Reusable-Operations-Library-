function getToken() {
  return localStorage.getItem('rol_token');
}

function setSession(token, user) {
  localStorage.setItem('rol_token', token);
  localStorage.setItem('rol_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('rol_token');
  localStorage.removeItem('rol_user');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('rol_user'));
  } catch (e) {
    return null;
  }
}

function requireAuth() {
  if (!getToken()) location.href = '/login.html';
}

function authFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + getToken() });
  return fetch(url, opts).then(function (res) {
    if (res.status === 401) {
      clearSession();
      location.href = '/login.html';
      throw new Error('Unauthorized');
    }
    return res;
  });
}

function logout() {
  clearSession();
  location.href = '/login.html';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}
