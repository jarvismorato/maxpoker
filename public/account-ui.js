(() => {
  const byId = id => document.getElementById(id);
  const dialog = byId('accountDialog');
  const defaults = { sound: true, motion: true, felt: 'classic' };
  let preferenceOwner = null;
  let googleConfig = null;
  let googleScript = null;
  let googleIntent = 'googleLogin';
  let googleRendered = '';

  function applyPreferences() {
    const prefs = window.maxpokerPreferences;
    document.body.classList.toggle('reduce-motion', !prefs.motion);
    document.body.dataset.felt = prefs.felt;
    byId('settingSound').checked = prefs.sound;
    byId('settingMotion').checked = prefs.motion;
    byId('settingFelt').value = prefs.felt;
  }

  window.refreshAccountSettings = () => {
    if (!currentAccount) return;
    const key = currentAccount.username.toLowerCase();
    if (preferenceOwner !== key) {
      preferenceOwner = key;
      let stored = {};
      try { stored = JSON.parse(localStorage.getItem('maxpoker_preferences_' + key)) || {}; } catch {}
      window.maxpokerPreferences = { ...defaults,
        sound: stored.sound !== false, motion: stored.motion !== false,
        felt: ['classic', 'blue', 'purple'].includes(stored.felt) ? stored.felt : 'classic' };
      applyPreferences();
    }
    byId('settingsAvatar').textContent = currentAccount.avatar;
    byId('settingsName').textContent = currentAccount.username;
    byId('settingsWallet').textContent = currentAccount.unlimitedChips ? '∞ fichas disponíveis' : currentAccount.bankroll.toLocaleString('pt-BR') + ' fichas disponíveis';
    byId('settingsHands').textContent = currentAccount.handsPlayed;
    byId('settingsWins').textContent = currentAccount.handsWon;
    byId('settingsWinRate').textContent = (currentAccount.handsPlayed ? Math.round(currentAccount.handsWon / currentAccount.handsPlayed * 100) : 0) + '%';
    byId('settingsAvatars').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.textContent === currentAccount.avatar)));
    byId('googleLinkStatus').textContent = currentAccount.googleLinked ? 'Google vinculado. Você já pode entrar com ele.' : googleConfig?.clientId ? 'Vincule seu Google para entrar nesta mesma conta, mantendo suas fichas.' : 'Login com Google em configuração.';
    byId('googleLinkButton').classList.toggle('hidden', !!currentAccount.googleLinked);
  };

  ['🦁', '🐯', '🦊', '🐼', '🐺', '🦅', '🐉', '🤖'].forEach((avatar, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = avatar;
    button.setAttribute('aria-label', ['Leão', 'Tigre', 'Raposa', 'Panda', 'Lobo', 'Águia', 'Dragão', 'Robô'][index]);
    button.addEventListener('click', () => sendMsg({ type: 'updateProfile', avatar }));
    byId('settingsAvatars').appendChild(button);
  });
  for (const id of ['lobbyAccountButton', 'tableAccountButton']) byId(id).addEventListener('click', () => {
    window.refreshAccountSettings(); sendMsg({ type: 'getAccount' }); dialog.showModal(); renderGoogleButtons();
  });
  byId('closeAccountDialog').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  byId('settingsLogout').addEventListener('click', () => { dialog.close(); sendMsg({ type: 'logout' }); });
  for (const id of ['settingSound', 'settingMotion', 'settingFelt']) byId(id).addEventListener('change', () => {
    window.maxpokerPreferences = { sound: byId('settingSound').checked, motion: byId('settingMotion').checked, felt: byId('settingFelt').value };
    applyPreferences();
    try { localStorage.setItem('maxpoker_preferences_' + preferenceOwner, JSON.stringify(window.maxpokerPreferences)); } catch { showToast('Não foi possível salvar as preferências neste navegador.'); }
  });

  function renderGoogleButtons() {
    if (!googleConfig?.clientId || !window.google?.accounts?.id) return;
    const signature = googleConfig.clientId + googleConfig.nonce;
    if (googleRendered !== signature) {
      window.google.accounts.id.initialize({ client_id: googleConfig.clientId, nonce: googleConfig.nonce, auto_select: false,
        callback: response => sendMsg({ type: googleIntent, credential: response.credential }) });
      googleRendered = signature;
      byId('googleLoginButton').replaceChildren();
      byId('googleLinkButton').replaceChildren();
      window.google.accounts.id.renderButton(byId('googleLoginButton'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'pt_BR', click_listener: () => { googleIntent = 'googleLogin'; } });
    }
    if (dialog.open && !byId('googleLinkButton').hasChildNodes() && !currentAccount?.googleLinked) {
      window.google.accounts.id.renderButton(byId('googleLinkButton'), { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'pt_BR', click_listener: () => { googleIntent = 'googleLink'; } });
    }
  }

  window.configureGoogleLogin = config => {
    googleConfig = config;
    if (!config?.clientId) return;
    byId('googleLoginArea').classList.remove('hidden');
    if (!googleScript) {
      googleScript = document.createElement('script');
      googleScript.src = 'https://accounts.google.com/gsi/client';
      googleScript.async = true;
      googleScript.onload = renderGoogleButtons;
      googleScript.onerror = () => { byId('googleLoginButton').textContent = 'Google indisponível. Recarregue a página ou entre com sua senha.'; };
      document.head.appendChild(googleScript);
    }
    renderGoogleButtons(); window.refreshAccountSettings();
  };
})();
