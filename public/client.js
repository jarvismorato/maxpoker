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
const maxBuyInInput = document.getElementById('maxBuyInInput');
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
    btnFold.disabled = btnCheckCall.disabled = btnBetRaise.disabled = betSlider.disabled = true;
    setTimeout(connect, 2000);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        myClientId = data.clientId;
        roomsData = data.rooms || [];
        renderRoomsList(roomsData);
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
  lobbyUserBankroll.textContent = `$${currentAccount.bankroll.toLocaleString('pt-BR')}`;

  tableUserAvatar.textContent = currentAccount.avatar || '🦁';
  tableUserName.textContent = currentAccount.username || 'Jogador';
  tableAccountChips.textContent = `$${currentAccount.bankroll.toLocaleString('pt-BR')}`;

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
      hard: 'Avançado'
    };
    const diffLabel = diffMap[room.botDifficulty] || 'Médio';

    const sBlind = room.smallBlind ?? 10;
    const bBlind = room.bigBlind ?? 20;
    const players = room.playerCount ?? room.totalCount ?? 0;
    const maxP = room.maxPlayers ?? room.maxSeats ?? 6;
    const minB = room.minBuyIn ?? 400;
    const maxB = room.maxBuyIn ?? 2000;

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
          <span class="meta-label">Assentos</span>
          <span class="meta-val">${players} / ${maxP}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Buy-in Mín.</span>
          <span class="meta-val gold">$${minB.toLocaleString('pt-BR')}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Buy-in Máx.</span>
          <span class="meta-val gold">$${maxB.toLocaleString('pt-BR')}</span>
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
  const maxB = room.maxBuyIn;
  const balance = currentAccount.bankroll;

  buyInMinLabel.textContent = `$${minB.toLocaleString('pt-BR')}`;
  buyInMaxLabel.textContent = `$${maxB.toLocaleString('pt-BR')}`;
  buyInBalanceLabel.textContent = `$${balance.toLocaleString('pt-BR')}`;

  if (balance < minB) {
    showToast(`Saldo insuficiente. Mínimo necessário: $${minB.toLocaleString('pt-BR')}`);
    return;
  }

  const effectiveMax = Math.min(maxB, balance);
  const defVal = Math.min(effectiveMax, Math.max(minB, room.defaultBuyIn || minB * 2));

  buyInSlider.min = minB;
  buyInSlider.max = effectiveMax;
  buyInSlider.step = 1;
  buyInSlider.value = defVal;

  updateBuyInDisplay(defVal);
  modalBuyIn.classList.remove('hidden');
}

function updateBuyInDisplay(val) {
  buyInSelectedDisplay.textContent = `$${Number(val).toLocaleString('pt-BR')}`;
}

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
  const amount = Number(buyInSlider.value);
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
  const maxB = Number(maxBuyInInput.value);
  if (!Number.isSafeInteger(minB) || !Number.isSafeInteger(maxB) || minB < 2000 || maxB < minB) {
    showToast('Mínimo de 2.000 fichas e máximo maior ou igual ao mínimo.'); return;
  }
  const botDifficulty = botDifficultySelect.value;
  const botSpeed = botSpeedSelect.value;
  const autoFillBots = autoFillBotsCheck.checked;

  sendMsg({
    type: 'createRoom',
    name,
    minBuyIn: minB,
    maxBuyIn: maxB,
    defaultBuyIn: Math.round((minB + maxB) / 2),
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
let previousWinnerReported = false;

function renderTable(table) {
  if (!table) return;
  currentTable = table;

  tableHeaderName.textContent = `${table.roomName || table.name} (Blinds $${table.smallBlind || 100}/$${table.bigBlind || 200})`;
  potDisplay.textContent = `POTE: $${table.pot.toLocaleString('pt-BR')}`;
  tableStatus.textContent = table.statusMsg || 'Mesa ativa.';

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
    tableAccountChips.textContent = `Saldo: $${currentAccount.bankroll.toLocaleString('pt-BR')}`;
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
    winnerTitle.textContent = `${w.name} Venceu a Mão!`;
    winnerDetail.textContent = `+$${w.amount.toLocaleString('pt-BR')} • ${w.handName}`;
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
  previousCardCount = currentCount;

  for (let i = 0; i < 5; i++) {
    const cardData = cards[i];
    if (cardData) {
      const cardEl = createCardElement(cardData);
      cardEl.classList.add('card-flip');
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
  for (let i = 0; i < 6; i++) {
    const seatEl = document.getElementById(`seat-${i}`);
    if (!seatEl) continue;

    seatEl.innerHTML = '';
    const seatData = table.seats[i];

    if (!seatData) {
      seatEl.className = `seat seat-${i} empty-seat`;
      seatEl.innerHTML = `
        <div class="seat-player-box">
          <div class="seat-avatar">🪑</div>
          <div class="seat-name">Vago</div>
        </div>
      `;
      continue;
    }

    const isMe = (seatData.id === myClientId);
    const isCurrentTurn = (table.currentTurnSeat === i && table.stage !== 'showdown');
    const isDealer = (table.dealerSeat === i);
    const isWinner = table.lastWinners && table.lastWinners.some((w) => w.seatIndex === i);

    seatEl.className = `seat seat-${i}`;
    if (isCurrentTurn) seatEl.classList.add('active-turn');
    if (seatData.folded) seatEl.classList.add('folded');
    if (isWinner) seatEl.classList.add('winner-seat');

    // Box do Jogador
    const box = document.createElement('div');
    box.className = 'seat-player-box';

    const displayName = isMe ? `${seatData.name} (Você)` : seatData.name;
    const chipsFmt = `$${seatData.chips.toLocaleString('pt-BR')}`;
    const statusTag = seatData.lastAction ? '<div class="seat-status-tag"></div>' : '';

    box.innerHTML = `
      <div class="seat-avatar"></div>
      <div class="seat-name"></div>
      <div class="seat-chips">${chipsFmt}</div>
      ${statusTag}
    `;

    box.querySelector('.seat-avatar').textContent = seatData.avatar || (seatData.isBot ? '🤖' : '👤');
    box.querySelector('.seat-name').textContent = displayName;
    if (seatData.lastAction) box.querySelector('.seat-status-tag').textContent = seatData.lastAction;

    if (isWinner) {
      const winData = table.lastWinners.find((w) => w.seatIndex === i);
      const winBadge = document.createElement('div');
      winBadge.className = 'seat-winner-badge';
      winBadge.textContent = `+$${winData.amount.toLocaleString('pt-BR')}`;
      box.appendChild(winBadge);
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

    seatEl.appendChild(box);
    seatEl.appendChild(cardsRow);

    // Ficha de Aposta Atual
    if (seatData.currentBet > 0) {
      const betChip = document.createElement('div');
      betChip.className = 'seat-bet-chip';
      betChip.textContent = `$${seatData.currentBet.toLocaleString('pt-BR')}`;
      seatEl.appendChild(betChip);
    }

    // Botão Dealer ("D") com rotação ao mudar
    if (isDealer) {
      const dealerBtn = document.createElement('div');
      dealerBtn.className = 'dealer-btn';
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
    betSlider.disabled = true;
    return;
  }

  // É a vez do jogador!
  actionConsole.classList.add('my-turn-highlight');
  btnFold.disabled = false;
  btnCheckCall.disabled = false;
  btnBetRaise.disabled = false;
  betSlider.disabled = false;

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
    betSlider.disabled = true;
  } else {
    const effectiveMin = Math.min(minBet, maxBet);
    betSlider.min = effectiveMin;
    betSlider.max = maxBet;
    betSlider.step = 1;
    if (Number(betSlider.value) < effectiveMin || Number(betSlider.value) > maxBet) {
      betSlider.value = effectiveMin;
    }

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
  playSound('chip');
  const amount = Number(betSlider.value);
  sendMsg({ type: 'action', action: 'raise', amount });
  btnFold.disabled = true;
  btnCheckCall.disabled = true;
  btnBetRaise.disabled = true;
});

window.addEventListener('DOMContentLoaded', () => {
  connect();
});
