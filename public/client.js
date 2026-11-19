// ==========================================
// MAXpoker - Cliente Web Oficial (Design Sóbrio)
// ==========================================

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}`;
let socket = null;

let myClientId = null;
let currentRoomId = null;
let mySeatIndex = -1;
let currentTable = null;
let roomsData = [];
let lastDealerSeat = -1;
let audioCtx = null;

// Efeitos Sonoros Sutis via Web Audio API
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (window.maxpokerPreferences?.sound === false) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'deal') {
      // Som suave de carta deslizando
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'chip') {
      // Som suave de ficha
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.06);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    } else if (type === 'win') {
      // Acorde suave de vitória
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0.08, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.4);
      });
    }
  } catch (e) {
    // Silencia se áudio for bloqueado pelo navegador
  }
}

// Dados da Conta
let currentAccount = null;
let bonusInterval = null;

// Telas
const authScreen = document.getElementById('authScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const tableScreen = document.getElementById('tableScreen');

// Elementos de Autenticação
const tabBtnLogin = document.getElementById('tabBtnLogin');
const tabBtnRegister = document.getElementById('tabBtnRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const loginUsernameInput = document.getElementById('loginUsername');
const loginPasswordInput = document.getElementById('loginPassword');
const regUsernameInput = document.getElementById('regUsername');
const regPasswordInput = document.getElementById('regPassword');
const authErrorMessage = document.getElementById('authErrorMessage');
const linkGoRegister = document.getElementById('linkGoRegister');
const linkGoLogin = document.getElementById('linkGoLogin');
const regAvatarGrid = document.getElementById('regAvatarGrid');
let selectedRegAvatar = '🦁';

// Elementos do Lobby
const lobbyUserAvatar = document.getElementById('lobbyUserAvatar');
const lobbyUserName = document.getElementById('lobbyUserName');
const lobbyUserBankroll = document.getElementById('lobbyUserBankroll');
const btnClaimBonus = document.getElementById('btnClaimBonus');
const bonusBtnLabel = document.getElementById('bonusBtnLabel');
const btnLogout = document.getElementById('btnLogout');
const btnOpenCreateModal = document.getElementById('btnOpenCreateModal');
const roomsList = document.getElementById('roomsList');

// Elementos da Mesa
const btnLeaveTable = document.getElementById('btnLeaveTable');
const tableHeaderName = document.getElementById('tableHeaderName');
const tableUserAvatar = document.getElementById('tableUserAvatar');
const tableUserName = document.getElementById('tableUserName');
const tableAccountChips = document.getElementById('tableAccountChips');
const potDisplay = document.getElementById('potDisplay');
const communityCards = document.getElementById('communityCards');
const tableStatus = document.getElementById('tableStatus');
const winnerBanner = document.getElementById('winnerBanner');
const winnerTitle = document.getElementById('winnerTitle');
const winnerDetail = document.getElementById('winnerDetail');
const actionConsole = document.querySelector('.action-console');

// Painel de Ações
const btnFold = document.getElementById('btnFold');
const btnCheckCall = document.getElementById('btnCheckCall');
const checkCallTitle = document.getElementById('checkCallTitle');
const checkCallSub = document.getElementById('checkCallSub');
const btnBetRaise = document.getElementById('btnBetRaise');
const betRaiseTitle = document.getElementById('betRaiseTitle');
const betRaiseSub = document.getElementById('betRaiseSub');
const raiseSliderBox = document.getElementById('raiseSliderBox');
const betSlider = document.getElementById('betSlider');
const raiseAmountInput = document.getElementById('raiseAmountInput');
const betSliderValue = document.getElementById('betSliderValue');
const presetMin = document.getElementById('presetMin');
const preset2x = document.getElementById('preset2x');
const preset3x = document.getElementById('preset3x');
const presetPot = document.getElementById('presetPot');
const presetAllIn = document.getElementById('presetAllIn');

// Modal de Buy-in
const modalBuyIn = document.getElementById('modalBuyIn');
const btnCloseBuyInModal = document.getElementById('btnCloseBuyInModal');
const buyInModalTableName = document.getElementById('buyInModalTableName');
const buyInMinLabel = document.getElementById('buyInMinLabel');
const buyInBalanceLabel = document.getElementById('buyInBalanceLabel');
const buyInMaxLabel = document.getElementById('buyInMaxLabel');
const buyInSelectedDisplay = document.getElementById('buyInSelectedDisplay');
const buyInSlider = document.getElementById('buyInSlider');
const buyInAmountInput = document.getElementById('buyInAmountInput');
const btnBuyInMin = document.getElementById('btnBuyInMin');
const btnBuyInHalf = document.getElementById('btnBuyInHalf');
const btnBuyInMax = document.getElementById('btnBuyInMax');
const btnConfirmBuyIn = document.getElementById('btnConfirmBuyIn');
let selectedTargetRoom = null;

// Modal de Criação de Mesa
const modalCreateRoom = document.getElementById('modalCreateRoom');
const btnCloseCreateModal = document.getElementById('btnCloseCreateModal');
const createRoomForm = document.getElementById('createRoomForm');
const roomNameInput = document.getElementById('roomNameInput');
const minBuyInInput = document.getElementById('minBuyInInput');
const botDifficultySelect = document.getElementById('botDifficultySelect');
const botSpeedSelect = document.getElementById('botSpeedSelect');
const autoFillBotsCheck = document.getElementById('autoFillBotsCheck');

// Toast
const toastNotification = document.getElementById('toastNotification');

// ==========================================
// CONEXÃO WEBSOCKET
// ==========================================
function connect() {
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    document.getElementById('connectionStatus').classList.add('hidden');
    console.log('MAXpoker conectado.');
    const savedToken = localStorage.getItem('maxpoker_token');
    if (savedToken) {
      sendMsg({ type: 'tokenAuth', token: savedToken });
    }
  };

  socket.onclose = () => {
    document.getElementById('connectionStatus').classList.remove('hidden');
    btnFold.disabled = btnCheckCall.disabled = btnBetRaise.disabled = betSlider.disabled = raiseAmountInput.disabled = true;
    setTimeout(connect, 2000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        if (data.google) window.configureGoogleLogin?.(data.google);
        myClientId = data.clientId;
        roomsData = data.rooms || [];
        renderRoomsList(roomsData);
      } else if (data.type === 'googleConfig') {
        window.configureGoogleLogin?.(data.google);
      } else if (data.type === 'authSuccess') {
        localStorage.setItem('maxpoker_token', data.token);
        currentAccount = data.account;
        hideAuthError();
        showLobbyScreen();
        updateAccountUI();
        if (roomsData.length > 0) renderRoomsList(roomsData);
      } else if (data.type === 'authError') {
        showAuthScreen();
        showAuthError(data.message);
      } else if (data.type === 'tokenExpired' || data.type === 'loggedOut') {
        localStorage.removeItem('maxpoker_token');
        currentAccount = null;
        document.getElementById('accountDialog').close();
        window.google?.accounts.id.disableAutoSelect();
        showAuthScreen();
      } else if (data.type === 'accountUpdate') {
        currentAccount = data.account;
        updateAccountUI();
      } else if (data.type === 'bonusGranted') {
        currentAccount.bankroll = data.bankroll;
        currentAccount.lastBonusClaim = data.lastBonusClaim;
        updateAccountUI();
        showToast(data.message);
      } else if (data.type === 'lobbyUpdate') {
        roomsData = data.rooms || [];
        renderRoomsList(roomsData);
      } else if (data.type === 'joinedRoom') {
        currentRoomId = data.roomId;
        showTableScreen();
        renderTable(data.table);
      } else if (data.type === 'tableUpdate') {
        renderTable(data.table);
      } else if (data.type === 'leftRoom') {
        currentRoomId = null;
        mySeatIndex = -1;
        if (data.account) {
          currentAccount = data.account;
          updateAccountUI();
        }
        showLobbyScreen();
        roomsData = data.rooms || [];
        renderRoomsList(roomsData);
      } else if (data.type === 'alert') {
        showToast(data.message);
      }
    } catch (err) {
      console.error('Erro na mensagem do servidor:', err);
    }
  };
}

function sendMsg(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(obj));
  } else {
    showToast('Sem conexão. Aguarde a reconexão antes de jogar.');
  }
}

// ==========================================
// TRANSIÇÃO DE TELAS
// ==========================================
function showAuthScreen() {
  authScreen.classList.remove('hidden');
  lobbyScreen.classList.add('hidden');
  tableScreen.classList.add('hidden');
  if (bonusInterval) clearInterval(bonusInterval);
}

function showLobbyScreen() {
  authScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  tableScreen.classList.add('hidden');
}

function showTableScreen() {
  authScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  tableScreen.classList.remove('hidden');
}

function showAuthError(msg) {
  authErrorMessage.textContent = msg;
  authErrorMessage.classList.remove('hidden');
}

function hideAuthError() {
  authErrorMessage.classList.add('hidden');
  authErrorMessage.textContent = '';
}

function showToast(msg) {
  toastNotification.textContent = msg;
  toastNotification.classList.remove('hidden');
  setTimeout(() => {
    toastNotification.classList.add('hidden');
  }, 4000);
}

// ==========================================
// CONTA E BÔNUS (4 HORAS)
// ==========================================
function updateAccountUI() {
  if (!currentAccount) return;

  lobbyUserAvatar.textContent = currentAccount.avatar || '🦁';
  lobbyUserName.textContent = currentAccount.username || 'Jogador';
  const walletLabel = currentAccount.unlimitedChips ? '∞ Fichas' : `$${currentAccount.bankroll.toLocaleString('pt-BR')}`;
  lobbyUserBankroll.textContent = walletLabel;

  tableUserAvatar.textContent = currentAccount.avatar || '🦁';
  tableUserName.textContent = currentAccount.username || 'Jogador';
  if (mySeatIndex === -1 || !currentTable?.seats?.[mySeatIndex]) {
    tableAccountChips.textContent = walletLabel;
  }

  window.refreshAccountSettings?.();
  startBonusCountdown();
}

function startBonusCountdown() {
  if (bonusInterval) clearInterval(bonusInterval);

  const COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const BONUS_VAL = 10000;

  const check = () => {
    if (!currentAccount) return;
    const lastClaim = currentAccount.lastBonusClaim || 0;
    const elapsed = Date.now() - lastClaim;
    const remaining = COOLDOWN_MS - elapsed;

    if (remaining <= 0) {
      btnClaimBonus.disabled = false;
      bonusBtnLabel.textContent = `🎁 +$${BONUS_VAL.toLocaleString('pt-BR')} Fichas`;
      if (bonusInterval) clearInterval(bonusInterval);
    } else {
      btnClaimBonus.disabled = true;
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      const pad = (n) => String(n).padStart(2, '0');
      bonusBtnLabel.textContent = `⏳ Bônus em ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
  };

  check();
  bonusInterval = setInterval(check, 1000);
}

btnClaimBonus.addEventListener('click', () => {
  sendMsg({ type: 'claimBonus' });
});

btnLogout.addEventListener('click', () => {
  sendMsg({ type: 'logout' });
});

// ==========================================
// FORMULÁRIOS DE AUTENTICAÇÃO
// ==========================================
tabBtnLogin.addEventListener('click', () => {
  tabBtnLogin.classList.add('active');
  tabBtnRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
  hideAuthError();
});

tabBtnRegister.addEventListener('click', () => {
  tabBtnRegister.classList.add('active');
  tabBtnLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
  hideAuthError();
});

if (linkGoRegister) {
  linkGoRegister.addEventListener('click', (e) => {
    e.preventDefault();
    tabBtnRegister.click();
  });
}

if (linkGoLogin) {
  linkGoLogin.addEventListener('click', (e) => {
    e.preventDefault();
    tabBtnLogin.click();
  });
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  hideAuthError();
  const username = loginUsernameInput.value.trim();
  const password = loginPasswordInput.value.trim();
  if (!username || !password) return;

  sendMsg({ type: 'login', username, password });
});

regAvatarGrid.querySelectorAll('.reg-avatar-opt').forEach((btn) => {
  btn.addEventListener('click', () => {
    regAvatarGrid.querySelectorAll('.reg-avatar-opt').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRegAvatar = btn.getAttribute('data-avatar');
  });
});

registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  hideAuthError();
  const username = regUsernameInput.value.trim();
  const password = regPasswordInput.value.trim();
  if (!username || !password) return;

  sendMsg({
    type: 'register',
    username,
    password,
    avatar: selectedRegAvatar
  });
});

// ==========================================
// RENDERIZAÇÃO DAS MESAS NO LOBBY
// ==========================================
function renderRoomsList(rooms) {
  roomsList.innerHTML = '';

  if (!rooms || rooms.length === 0) {
    roomsList.innerHTML = '<div style="color: #6e7681; padding: 16px;">Nenhuma mesa aberta. Crie uma nova acima!</div>';
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement('div');
    card.className = 'room-card-clean';

    const diffMap = {
      easy: 'Iniciante',
      medium: 'Intermediário',
      hard: 'Avançado',
      impossible: 'Impossível'
    };
    const diffLabel = room.autoFillBots ? (diffMap[room.botDifficulty] || 'Médio') : 'Só pessoas';

    const sBlind = room.smallBlind ?? 10;
    const bBlind = room.bigBlind ?? 20;
    const maxP = room.maxPlayers ?? room.maxSeats ?? 6;
    const minB = room.minBuyIn ?? 400;

    card.innerHTML = `
      <div class="room-header">
        <span class="room-title-text"></span>
        <span class="badge-pill">${diffLabel}</span>
      </div>

      <div class="room-meta-grid">
        <div class="meta-item">
          <span class="meta-label">Blinds</span>
          <span class="meta-val">$${sBlind.toLocaleString('pt-BR')} / $${bBlind.toLocaleString('pt-BR')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Jogadores</span>
          <span class="meta-val">${room.humanCount ?? 0} pessoas · ${room.botCount ?? 0} bots</span>
          <span class="meta-label">${room.waitingCount ?? 0} aguardando · ${maxP} vagas humanas</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Buy-in Mín.</span>
          <span class="meta-val gold">$${minB.toLocaleString('pt-BR')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Buy-in Máx.</span>
          <span class="meta-val gold">Sem limite</span>
        </div>
      </div>

      <button class="btn-join-room" >
        Jogar
      </button>
    `;

    card.querySelector('.room-title-text').textContent = room.name;
    const joinBtn = card.querySelector('.btn-join-room');
    joinBtn.addEventListener('click', () => {
      openBuyInModal(room);
    });

    roomsList.appendChild(card);
  });
}

// ==========================================
// MODAL DE BUY-IN
// ==========================================
function openBuyInModal(room) {
  if (!currentAccount) {
    showToast('Faça login primeiro para jogar!');
    showAuthScreen();
    return;
  }

  selectedTargetRoom = room;
  buyInModalTableName.textContent = room.name;

  const minB = room.minBuyIn;
  const balance = currentAccount.bankroll;

  buyInMinLabel.textContent = `$${minB.toLocaleString('pt-BR')}`;
  buyInMaxLabel.textContent = 'Sem limite';
  buyInBalanceLabel.textContent = currentAccount.unlimitedChips ? '∞' : `${balance.toLocaleString('pt-BR')}`;

  if (balance < minB) {
    showToast(`Saldo insuficiente. Mínimo necessário: $${minB.toLocaleString('pt-BR')}`);
    return;
  }

  const effectiveMax = balance;
  const defVal = Math.min(effectiveMax, Math.max(minB, room.defaultBuyIn || minB * 2));

  buyInSlider.min = minB;
  buyInSlider.max = effectiveMax;
  buyInSlider.step = 1;
  buyInSlider.value = defVal;
  buyInAmountInput.min = minB;
  buyInAmountInput.max = effectiveMax;

  updateBuyInDisplay(defVal);
  modalBuyIn.classList.remove('hidden');
}

function updateBuyInDisplay(val) {
  buyInAmountInput.value = val;
  buyInAmountInput.setCustomValidity('');
  buyInSelectedDisplay.textContent = `$${Number(val).toLocaleString('pt-BR')}`;
}

buyInAmountInput.addEventListener('input', () => {
  buyInAmountInput.setCustomValidity('');
  if (buyInAmountInput.validity.valid) {
    buyInSlider.value = buyInAmountInput.value;
    buyInSelectedDisplay.textContent = `$${Number(buyInAmountInput.value).toLocaleString('pt-BR')}`;
  } else {
    buyInSelectedDisplay.textContent = 'Escolha um valor válido';
  }
});

buyInSlider.addEventListener('input', (e) => {
  updateBuyInDisplay(e.target.value);
});

btnBuyInMin.addEventListener('click', () => {
  buyInSlider.value = buyInSlider.min;
  updateBuyInDisplay(buyInSlider.min);
});

btnBuyInHalf.addEventListener('click', () => {
  const half = Math.round((Number(buyInSlider.min) + Number(buyInSlider.max)) / 2);
  buyInSlider.value = half;
  updateBuyInDisplay(buyInSlider.value);
});

btnBuyInMax.addEventListener('click', () => {
  buyInSlider.value = buyInSlider.max;
  updateBuyInDisplay(buyInSlider.max);
});

btnCloseBuyInModal.addEventListener('click', () => {
  modalBuyIn.classList.add('hidden');
  selectedTargetRoom = null;
});

btnConfirmBuyIn.addEventListener('click', () => {
  if (!selectedTargetRoom) return;
  const amount = Number(buyInAmountInput.value);
  const availableMax = currentAccount.bankroll;
  buyInAmountInput.max = availableMax;
  if (!buyInAmountInput.reportValidity()) return;
  if (!Number.isSafeInteger(amount) || amount < selectedTargetRoom.minBuyIn || amount > availableMax) {
    showToast('Escolha um valor inteiro dentro dos limites da mesa e do seu saldo.');
    return;
  }
  sendMsg({
    type: 'joinRoom',
    roomId: selectedTargetRoom.id,
    buyInAmount: amount
  });
  modalBuyIn.classList.add('hidden');
});

// ==========================================
// CRIAR MESA
// ==========================================
btnOpenCreateModal.addEventListener('click', () => {
  modalCreateRoom.classList.remove('hidden');
});

btnCloseCreateModal.addEventListener('click', () => {
  modalCreateRoom.classList.add('hidden');
});

createRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = roomNameInput.value.trim() || 'Mesa MAXpoker';
  const minB = Number(minBuyInInput.value);
  if (!Number.isSafeInteger(minB) || minB < 2000) {
    showToast('Mínimo de 2.000 fichas.'); return;
  }
  const botDifficulty = botDifficultySelect.value;
  const botSpeed = botSpeedSelect.value;
  const autoFillBots = autoFillBotsCheck.checked;

  sendMsg({
    type: 'createRoom',
    name,
    minBuyIn: minB,
    defaultBuyIn: minB,
    botDifficulty,
    botSpeed,
    autoFillBots
  });

  modalCreateRoom.classList.add('hidden');
});

// SAIR DA MESA
btnLeaveTable.addEventListener('click', () => {
  if (confirm('Deseja sair da mesa? Suas fichas retornarão para seu saldo.')) {
    sendMsg({ type: 'leaveRoom' });
  }
});

// ==========================================
// RENDERIZAÇÃO DA MESA DE POKER
// ==========================================
let previousCardCount = 0;
let renderedHand = '';
let previousSeatCards = new Map();
let previousSeatBets = new Map();
let previousWinnerReported = false;

function renderTable(table) {
  if (!table) return;
  const handKey = currentRoomId + ':' + table.handNumber;
  if (renderedHand !== handKey) {
    renderedHand = handKey; previousCardCount = 0; previousSeatCards.clear(); previousSeatBets.clear();
  }
  currentTable = table;
  document.getElementById('waitingSeatNotice').classList.toggle('hidden', !table.waitingForSeat);

  tableHeaderName.textContent = `${table.roomName || table.name} (Blinds $${table.smallBlind || 100}/$${table.bigBlind || 200})`;
  potDisplay.textContent = `POTE: $${table.pot.toLocaleString('pt-BR')}`;
  tableStatus.textContent = table.waitingForSeat ? 'Vaga reservada: você entra na próxima mão, sem débito até sentar.' : (table.statusMsg || 'Mesa ativa.');

  // Localiza meu assento
  mySeatIndex = -1;
  for (let i = 0; i < table.seats.length; i++) {
    const s = table.seats[i];
    if (s && s.id === myClientId) {
      mySeatIndex = i;
      break;
    }
  }

  // Atualiza fichas do jogador no topo da mesa
  if (mySeatIndex !== -1 && table.seats[mySeatIndex]) {
    const mySeat = table.seats[mySeatIndex];
    tableAccountChips.textContent = `Fichas: $${mySeat.chips.toLocaleString('pt-BR')}`;
  } else if (currentAccount) {
    tableAccountChips.textContent = currentAccount.unlimitedChips ? 'Saldo: ∞' : `Saldo: ${currentAccount.bankroll.toLocaleString('pt-BR')}`;
  }

  // Notificação de Vencedor
  handleWinnerDisplay(table);

  // Cartas Comunitárias
  renderCommunityCards(table.communityCards || []);

  // Assentos e Cartas dos Jogadores
  renderSeats(table);

  // Painel de Ações
  updateActionConsole(table);
}

function handleWinnerDisplay(table) {
  if (table.lastWinners && table.lastWinners.length > 0) {
    const w = table.lastWinners[0];
    if (table.lastWinners.length > 1) {
      winnerTitle.textContent = `Pote dividido: ${table.lastWinners.map((winner) => winner.name).join(', ')}`;
      winnerDetail.textContent = `+$${w.amount.toLocaleString('pt-BR')} cada • ${w.handName}`;
    } else {
      winnerTitle.textContent = `${w.name} Venceu a Mão!`;
      winnerDetail.textContent = `+$${w.amount.toLocaleString('pt-BR')} • ${w.handName}`;
    }
    winnerBanner.classList.remove('hidden');

    if (!previousWinnerReported) {
      playSound('win');
      previousWinnerReported = true;
    }
  } else {
    winnerBanner.classList.add('hidden');
    previousWinnerReported = false;
  }
}

function renderCommunityCards(cards) {
  communityCards.innerHTML = '';
  const currentCount = cards.length;

  if (currentCount > previousCardCount) {
    playSound('deal');
  }
  const oldCount = previousCardCount;
  previousCardCount = currentCount;

  for (let i = 0; i < 5; i++) {
    const cardData = cards[i];
    if (cardData) {
      const cardEl = createCardElement(cardData);
      if (i >= oldCount) { cardEl.classList.add('card-flip'); cardEl.style.animationDelay = ((i - oldCount) * 100) + 'ms'; }
      communityCards.appendChild(cardEl);
    }
  }
}

// Criação Real de Carta com Índice nos Cantos e Naipe Central
function createCardElement(card) {
  const el = document.createElement('div');
  const suit = card.suit || '♠';
  const rank = String(card.rank || card.label || 'A');
  const isRed = (suit === '♥' || suit === '♦' || card.color === 'red');

  el.className = `poker-card ${isRed ? 'red' : 'black'}`;
  el.innerHTML = `
    <div class="card-corner top-left">
      <span class="card-rank">${rank}</span>
      <span class="card-suit-mini">${suit}</span>
    </div>
    <div class="card-center-suit">${suit}</div>
    <div class="card-corner bottom-right">
      <span class="card-rank">${rank}</span>
      <span class="card-suit-mini">${suit}</span>
    </div>
  `;
  return el;
}

function renderSeats(table) {
  const offset = mySeatIndex !== -1 ? mySeatIndex : 0;

  for (let i = 0; i < 6; i++) {
    const visualPos = (i - offset + 6) % 6;
    const seatEl = document.getElementById(`seat-${visualPos}`);
    if (!seatEl) continue;

    seatEl.innerHTML = '';
    seatEl.dataset.seat = String(i);
    const seatData = table.seats[i];

    if (!seatData) {
      seatEl.className = `seat seat-${visualPos} empty-seat`;
      seatEl.innerHTML = `
        <div class="seat-player-box">
          <div class="seat-identity">
            <div class="seat-avatar">🪑</div>
            <div class="seat-info"><div class="seat-name">Vago</div></div>
          </div>
        </div>
      `;
      continue;
    }

    const isMe = (seatData.id === myClientId);
    const isCurrentTurn = (table.currentTurnSeat === i && table.stage !== 'showdown');
    const isDealer = (table.dealerSeat === i);
    const isWinner = table.lastWinners && table.lastWinners.some((w) => w.seatIndex === i);

    seatEl.className = `seat seat-${visualPos}`;
    if (isCurrentTurn) seatEl.classList.add('active-turn');
    if (seatData.folded) seatEl.classList.add('folded');
    if (isWinner) seatEl.classList.add('winner-seat');
    if (isMe) seatEl.classList.add('is-me');

    // Box do Jogador
    const box = document.createElement('div');
    box.className = 'seat-player-box';

    const displayName = isMe ? `${seatData.name} (Você)` : seatData.name;
    const chipsFmt = `$${seatData.chips.toLocaleString('pt-BR')}`;

    box.innerHTML = `
      <div class="seat-identity">
        <div class="seat-avatar"></div>
        <div class="seat-info">
          <div class="seat-name"></div>
          <div class="seat-chips"></div>
        </div>
      </div>
    `;

    box.querySelector('.seat-avatar').textContent = seatData.avatar || (seatData.isBot ? '🤖' : '👤');
    box.querySelector('.seat-name').textContent = displayName;
    box.querySelector('.seat-chips').textContent = chipsFmt;

    if (seatData.lastAction || isWinner) {
      const metaRow = document.createElement('div');
      metaRow.className = 'seat-meta-row';

      if (seatData.lastAction) {
        const statusTag = document.createElement('div');
        statusTag.className = 'seat-status-tag';
        statusTag.textContent = seatData.lastAction;
        metaRow.appendChild(statusTag);
      }

      if (isWinner) {
        const winData = table.lastWinners.find((w) => w.seatIndex === i);
        const winBadge = document.createElement('div');
        winBadge.className = 'seat-winner-badge';
        winBadge.textContent = `+$${winData.amount.toLocaleString('pt-BR')}`;
        metaRow.appendChild(winBadge);
      }

      box.appendChild(metaRow);
    }

    // Cartas do Jogador (Cartas de mão)
    const cardsRow = document.createElement('div');
    cardsRow.className = 'seat-hole-cards';

    if (seatData.cards && seatData.cards.length > 0) {
      seatData.cards.forEach((c) => {
        const rank = c.rank || c.label;
        // Se for a própria mão do jogador ou estiver em showdown, exibe faceup!
        if (rank && c.suit && !c.hidden) {
          const cardEl = createCardElement({ ...c, rank });
          if (isWinner) cardEl.classList.add('winner-card-pulse');
          cardsRow.appendChild(cardEl);
        } else {
          // Carta virada para baixo
          const backEl = document.createElement('div');
          backEl.className = 'poker-card card-back';
          cardsRow.appendChild(backEl);
        }
      });
    }

    const cardSignature = JSON.stringify(seatData.cards || []);
    const previousCards = previousSeatCards.get(seatData.id);
    const hadCards = Boolean(previousCards && previousCards !== '[]');
    if (previousCards !== cardSignature) {
      Array.from(cardsRow.children).forEach((card, index) => {
        card.classList.add(hadCards ? 'card-reveal' : 'card-deal');
        card.style.animationDelay = (index * 90 + (hadCards ? 0 : i * 45)) + 'ms';
      });
    }
    previousSeatCards.set(seatData.id, cardSignature);
    seatEl.appendChild(box);
    seatEl.appendChild(cardsRow);

    // Ficha de Aposta Atual
    if (seatData.currentBet > 0) {
      const betChip = document.createElement('div');
      betChip.className = 'seat-bet-chip';
      if (previousSeatBets.get(seatData.id) !== seatData.currentBet) betChip.classList.add('chip-arrive');
      betChip.textContent = `$${seatData.currentBet.toLocaleString('pt-BR')}`;
      seatEl.appendChild(betChip);
    }

    previousSeatBets.set(seatData.id, seatData.currentBet);

    // Botão Dealer ("D") com rotação ao mudar
    if (isDealer) {
      const dealerBtn = document.createElement('div');
      dealerBtn.className = 'dealer-btn';
      if (lastDealerSeat !== table.dealerSeat) dealerBtn.classList.add('dealer-move');
      dealerBtn.textContent = 'D';
      dealerBtn.title = 'Dealer';
      seatEl.appendChild(dealerBtn);
    }
  }

  lastDealerSeat = table.dealerSeat;
}

// ==========================================
// PAINEL DE AÇÃO
// ==========================================
function updateActionConsole(table) {
  const isMyTurn = (mySeatIndex !== -1 && table.currentTurnSeat === mySeatIndex && table.stage !== 'showdown');
  const mySeat = mySeatIndex !== -1 ? table.seats[mySeatIndex] : null;

  if (!isMyTurn || !mySeat || mySeat.folded || mySeat.chips <= 0) {
    actionConsole.classList.remove('my-turn-highlight');
    btnFold.disabled = true;
    btnCheckCall.disabled = true;
    btnBetRaise.disabled = true;
    betSlider.disabled = raiseAmountInput.disabled = true;
    return;
  }

  // É a vez do jogador!
  actionConsole.classList.add('my-turn-highlight');
  btnFold.disabled = false;
  btnCheckCall.disabled = false;
  btnBetRaise.disabled = false;
  betSlider.disabled = raiseAmountInput.disabled = false;

  const currentBet = table.currentBet || 0;
  const myBet = mySeat.currentBet || 0;
  const callAmount = Math.min(mySeat.chips, currentBet - myBet);

  // Configuração Check / Call
  if (callAmount <= 0) {
    checkCallTitle.textContent = 'CHECK';
    checkCallSub.textContent = 'Passar';
  } else {
    checkCallTitle.textContent = 'CALL';
    checkCallSub.textContent = `Pagar $${callAmount.toLocaleString('pt-BR')}`;
  }

  // Configuração Slider e Bet / Raise
  const bigB = table.minRaise || 20;
  const minBet = currentBet === 0 ? bigB : currentBet + bigB;
  const maxBet = mySeat.chips + myBet;

  if (maxBet <= currentBet || mySeat.canRaise === false) {
    btnBetRaise.disabled = true;
    betSlider.disabled = raiseAmountInput.disabled = true;
  } else {
    const effectiveMin = Math.min(minBet, maxBet);
    betSlider.min = effectiveMin;
    betSlider.max = maxBet;
    betSlider.step = 1;
    raiseAmountInput.min = effectiveMin;
    raiseAmountInput.max = maxBet;
    if (Number(betSlider.value) < effectiveMin || Number(betSlider.value) > maxBet) {
      betSlider.value = effectiveMin;
    }

    if (document.activeElement !== raiseAmountInput) raiseAmountInput.value = betSlider.value;
    const currentSliderVal = Number(betSlider.value);
    betSliderValue.textContent = `$${currentSliderVal.toLocaleString('pt-BR')}`;

    if (currentBet === 0) {
      betRaiseTitle.textContent = 'APOSTAR';
      betRaiseSub.textContent = `$${currentSliderVal.toLocaleString('pt-BR')}`;
    } else {
      betRaiseTitle.textContent = 'AUMENTAR';
      betRaiseSub.textContent = `Para $${currentSliderVal.toLocaleString('pt-BR')}`;
    }
  }
}

betSlider.addEventListener('input', (e) => {
  const val = Number(e.target.value);
  raiseAmountInput.value = val;
  betSliderValue.textContent = `$${val.toLocaleString('pt-BR')}`;
  const currentBet = currentTable ? currentTable.currentBet : 0;
  if (currentBet === 0) {
    betRaiseTitle.textContent = 'APOSTAR';
    betRaiseSub.textContent = `$${val.toLocaleString('pt-BR')}`;
  } else {
    betRaiseTitle.textContent = 'AUMENTAR';
    betRaiseSub.textContent = `Para $${val.toLocaleString('pt-BR')}`;
  }
});

raiseAmountInput.addEventListener('input', () => {
  if (!raiseAmountInput.validity.valid) {
    betRaiseSub.textContent = 'Valor inválido';
    return;
  }
  betSlider.value = raiseAmountInput.value;
  betSlider.dispatchEvent(new Event('input'));
});

presetMin.addEventListener('click', () => {
  betSlider.value = betSlider.min;
  betSlider.dispatchEvent(new Event('input'));
});

preset2x.addEventListener('click', () => {
  const target = Math.min(Number(betSlider.max), Number(betSlider.min) * 2);
  betSlider.value = target;
  betSlider.dispatchEvent(new Event('input'));
});

preset3x.addEventListener('click', () => {
  const target = Math.min(Number(betSlider.max), Number(betSlider.min) * 3);
  betSlider.value = target;
  betSlider.dispatchEvent(new Event('input'));
});

presetPot.addEventListener('click', () => {
  if (!currentTable) return;
  const potVal = Math.min(Number(betSlider.max), Math.max(Number(betSlider.min), currentTable.pot));
  betSlider.value = potVal;
  betSlider.dispatchEvent(new Event('input'));
});

presetAllIn.addEventListener('click', () => {
  betSlider.value = betSlider.max;
  betSlider.dispatchEvent(new Event('input'));
});

btnFold.addEventListener('click', () => {
  playSound('chip');
  sendMsg({ type: 'action', action: 'fold' });
  btnFold.disabled = true;
  btnCheckCall.disabled = true;
  btnBetRaise.disabled = true;
});

btnCheckCall.addEventListener('click', () => {
  playSound('chip');
  sendMsg({ type: 'action', action: currentTable.currentBet === currentTable.seats[mySeatIndex].currentBet ? 'check' : 'call' });
  btnFold.disabled = true;
  btnCheckCall.disabled = true;
  btnBetRaise.disabled = true;
});

btnBetRaise.addEventListener('click', () => {
  if (raiseAmountInput.disabled || !raiseAmountInput.reportValidity()) return;
  const amount = Number(raiseAmountInput.value);
  if (!Number.isSafeInteger(amount)) return;
  playSound('chip');
  sendMsg({ type: 'action', action: 'raise', amount });
  btnFold.disabled = true;
  btnCheckCall.disabled = true;
  btnBetRaise.disabled = true;
});

window.addEventListener('DOMContentLoaded', () => {
  connect();
});
