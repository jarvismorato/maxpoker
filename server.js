const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ACCOUNTS_FILE = process.env.ACCOUNTS_FILE || path.join(__dirname, 'accounts.json');
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.RENDER === 'true' && !DATABASE_URL) {
  throw new Error('DATABASE_URL obrigatória no Render: armazenamento temporário recusado.');
}
let databaseStore = null;
let durableQueue = null;
let databaseDirty = false;
let deliveries = null;
let storageReady = false;

function runStateChange(action) {
  return durableQueue ? durableQueue.run(action) : action();
}
const scheduledTasks = new Map();
function scheduleTask(action, delay) {
  const ticket = { cancelled: false };
  const timer = setTimeout(() => runStateChange(() => {
    scheduledTasks.delete(timer);
    if (!ticket.cancelled) return action();
  }), delay);
  scheduledTasks.set(timer, ticket);
  return timer;
}
function cancelTask(timer) {
  const ticket = scheduledTasks.get(timer);
  if (ticket) ticket.cancelled = true;
  scheduledTasks.delete(timer);
  clearTimeout(timer);
}

// Regras de Fichas
const DEFAULT_START_CHIPS = 50000; // Contas normais começam com 50.000
const USER_VIP_CHIPS = 100000000000; // Conta especial (100 bilhões / infinitas)
const BONUS_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 horas
const BONUS_AMOUNT = 10000; // +10.000 a cada 4 horas

// ==========================================
// Persistência de Contas e Senhas
// ==========================================
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function normalizeAccounts(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Contas inválidas');
  const normalized = Object.create(null);
  for (const [key, acc] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (!acc || typeof acc !== 'object' || !acc.salt || !acc.passwordHash ||
        !Number.isSafeInteger(acc.bankroll) || acc.bankroll < 0 ||
        !Number.isSafeInteger(acc.tableEscrow ?? 0) || (acc.tableEscrow ?? 0) < 0 ||
        !Number.isSafeInteger(acc.bankroll + (acc.tableEscrow ?? 0))) {
      throw new Error('Registro de conta inválido: ' + lowerKey);
    }
    if (!acc.lastBonusClaim) acc.lastBonusClaim = 0;

    acc.bankroll += acc.tableEscrow || 0;
    acc.tableEscrow = 0;

    normalized[lowerKey] = acc;
  }
  return normalized;
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      return normalizeAccounts(data);
    }
  } catch (e) {
    throw new Error('Contas inválidas: inicialização cancelada para preservar dados.', { cause: e });
  }

  return Object.create(null);
}

const accounts = DATABASE_URL ? Object.create(null) : loadAccounts();

function saveAccounts() {
  for (const acc of Object.values(accounts)) acc.tableEscrow = 0;
  for (const room of rooms.values()) for (const seat of room.seats) {
    if (!seat || seat.isBot || seat.departed) continue;
    const acc = accounts[seat.username.toLowerCase()];
    if (acc) acc.tableEscrow += seat.chips + (seat.totalBet || 0);
  }
  if (databaseStore) { databaseDirty = true; return; }
  try {
    fs.writeFileSync(ACCOUNTS_FILE + '.tmp', JSON.stringify(accounts, null, 2), 'utf8');
    fs.renameSync(ACCOUNTS_FILE + '.tmp', ACCOUNTS_FILE);
  } catch (error) {
    console.error('Falha ao persistir fichas. Servidor interrompido; o último snapshot será recuperado.', error);
    process.exit(1);
  }
}

// Tokens de sessão em memória
const sessionTokens = new Map();

// ==========================================
// Servidor HTTP Estático
// ==========================================
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(storageReady ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: storageReady ? 'ok' : 'unavailable', storage: DATABASE_URL ? 'postgres' : 'file' }));
    return;
  }
  let reqPath = req.url === '/' ? '/index.html' : req.url;
  let pathname;
  try { pathname = decodeURIComponent(new URL(reqPath, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  const filePath = path.resolve(PUBLIC_DIR, '.' + pathname);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Não Encontrado');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 16384 });

// ==========================================
// Baralho 100% Aleatório (Criptograficamente Seguro)
// ==========================================
const SUITS = [
  { symbol: '♠', color: 'black' },
  { symbol: '♥', color: 'red' },
  { symbol: '♦', color: 'red' },
  { symbol: '♣', color: 'black' }
];

const RANKS = [
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5' },
  { value: 6, label: '6' },
  { value: 7, label: '7' },
  { value: 8, label: '8' },
  { value: 9, label: '9' },
  { value: 10, label: '10' },
  { value: 11, label: 'J' },
  { value: 12, label: 'Q' },
  { value: 13, label: 'K' },
  { value: 14, label: 'A' }
];

const HAND_NAMES = {
  9: 'Straight Flush',
  8: 'Quadra',
  7: 'Full House',
  6: 'Flush',
  5: 'Sequência',
  4: 'Trinca',
  3: 'Dois Pares',
  2: 'Um Par',
  1: 'Carta Alta'
};

function createCryptoShuffledDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({
        value: r.value,
        rank: r.label,
        label: r.label,
        suit: s.symbol,
        color: s.color
      });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const head = arr[0];
  const tail = arr.slice(1);
  const withHead = getCombinations(tail, k - 1).map(c => [head, ...c]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

function evaluate5Cards(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;

  const countPairs = Object.entries(counts).map(([val, cnt]) => ({
    val: Number(val),
    cnt
  })).sort((a, b) => b.cnt - a.cnt || b.val - a.val);

  let isStraight = false;
  let straightHigh = 0;
  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 5) {
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      isStraight = true;
      straightHigh = uniqueValues[0];
    } else if (
      uniqueValues[0] === 14 &&
      uniqueValues[1] === 5 &&
      uniqueValues[2] === 4 &&
      uniqueValues[3] === 3 &&
      uniqueValues[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isFlush && isStraight) return [9, straightHigh];
  if (countPairs[0].cnt === 4) return [8, countPairs[0].val, countPairs[1].val];
  if (countPairs[0].cnt === 3 && countPairs[1].cnt === 2) return [7, countPairs[0].val, countPairs[1].val];
  if (isFlush) return [6, ...values];
  if (isStraight) return [5, straightHigh];
  if (countPairs[0].cnt === 3) return [4, countPairs[0].val, countPairs[1].val, countPairs[2].val];
  if (countPairs[0].cnt === 2 && countPairs[1].cnt === 2) return [3, countPairs[0].val, countPairs[1].val, countPairs[2].val];
  if (countPairs[0].cnt === 2) return [2, countPairs[0].val, ...countPairs.slice(1).map(p => p.val)];
  return [1, ...values];
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const valA = a[i] || 0;
    const valB = b[i] || 0;
    if (valA !== valB) return valA - valB;
  }
  return 0;
}

function getBestHand(allCards) {
  if (allCards.length < 5) return null;
  const combos = getCombinations(allCards, 5);
  let best = null;
  for (const combo of combos) {
    const score = evaluate5Cards(combo);
    if (!best || compareScores(score, best.score) > 0) {
      best = { score, cards: combo, name: HAND_NAMES[score[0]] };
    }
  }
  return best;
}

// ==========================================
// Gerenciamento de Mesas MAXpoker
// ==========================================
const NUM_SEATS = 6;
const SMALL_BLIND = 100;
const BIG_BLIND = 200;
const BOT_NAMES = ['MAXBot Negreanu', 'MAXBot Ivey', 'MAXBot Antonius', 'MAXBot Brunson', 'MAXBot Cates', 'MAXBot Dwan'];
const BOT_AVATARS = ['🤖', '🦾', '👾', '🎩', '🐺', '🦊'];

const rooms = new Map();
const clients = new Map(); // ws => { id, username, roomId, seatIndex }

function createRoom(options = {}) {
  const roomId = options.id || 'room_' + Math.random().toString(36).substring(2, 8);
  const roomName = options.name || 'Mesa MAXpoker';
  const botDifficulty = options.botDifficulty || 'medium';
  const botSpeed = options.botSpeed || 'normal';
  const autoFillBots = options.autoFillBots !== undefined ? options.autoFillBots : true;

  const minBuyIn = Number(options.minBuyIn) || 4000;
  const maxBuyIn = Number(options.maxBuyIn) || 50000;
  const defaultBuyIn = Number(options.defaultBuyIn) || 10000;

  const room = {
    id: roomId,
    name: roomName,
    botDifficulty,
    botSpeed,
    autoFillBots,
    minBuyIn,
    maxBuyIn,
    defaultBuyIn,
    seats: Array(NUM_SEATS).fill(null),
    pot: 0,
    communityCards: [],
    deck: [],
    stage: 'waiting',
    dealerSeat: 0,
    currentTurnSeat: null,
    currentBet: 0,
    minRaise: BIG_BLIND,
    handInProgress: false,
    statusMsg: 'Mesa pronta! Escolha seu Buy-in para começar.',
    timer: null,
    botTimer: null
  };

  rooms.set(roomId, room);
  return room;
}

// Mesas pré-definidas com buy-ins proporcionais aos 50.000 / 100 bilhões
createRoom({
  id: 'mesa-iniciante',
  name: 'Mesa 1 - Iniciantes ($4.000 - $20.000)',
  botDifficulty: 'easy',
  botSpeed: 'slow',
  minBuyIn: 4000,
  maxBuyIn: 20000,
  defaultBuyIn: 10000,
  autoFillBots: true
});

createRoom({
  id: 'mesa-padrao',
  name: 'Mesa 2 - Regular ($10.000 - $50.000)',
  botDifficulty: 'medium',
  botSpeed: 'normal',
  minBuyIn: 10000,
  maxBuyIn: 50000,
  defaultBuyIn: 25000,
  autoFillBots: true
});

createRoom({
  id: 'mesa-highroller',
  name: 'Mesa 3 - High Roller VIP ($50.000 - $500.000)',
  botDifficulty: 'hard',
  botSpeed: 'normal',
  minBuyIn: 50000,
  maxBuyIn: 500000,
  defaultBuyIn: 100000,
  autoFillBots: true
});

// ==========================================
// Conexões WebSocket & Autenticação
// ==========================================
wss.on('connection', (ws) => {
  runStateChange(() => {
  const clientId = 'user_' + Math.random().toString(36).substring(2, 9);
  clients.set(ws, { id: clientId, username: null, roomId: null, seatIndex: -1 });

  sendToClient(ws, {
    type: 'init',
    clientId,
    rooms: getRoomsSummary()
  });
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      runStateChange(() => handleClientMessage(ws, msg));
    } catch (e) {
      console.error('Erro na mensagem do cliente:', e);
    }
  });

  ws.on('close', () => runStateChange(() => {
    const client = clients.get(ws);
    if (!client) return;
    client.disconnected = true;
    client.disconnectTimer = scheduleTask(() => {
      leaveCurrentRoom(ws);
      clients.delete(ws);
      broadcastLobby();
    }, 30000);
  }));
});

function getRoomsSummary() {
  const summary = [];
  for (const room of rooms.values()) {
    const humanCount = room.seats.filter(s => s && !s.isBot).length;
    const totalCount = room.seats.filter(s => s !== null).length;
    summary.push({
      id: room.id,
      name: room.name,
      botDifficulty: room.botDifficulty,
      botSpeed: room.botSpeed,
      autoFillBots: room.autoFillBots,
      minBuyIn: room.minBuyIn,
      maxBuyIn: room.maxBuyIn,
      defaultBuyIn: room.defaultBuyIn,
      humanCount,
      totalCount,
      playerCount: totalCount,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      maxPlayers: NUM_SEATS,
      maxSeats: NUM_SEATS
    });
  }
  return summary;
}

function broadcastLobby() {
  const summary = getRoomsSummary();
  for (const [ws, client] of clients.entries()) {
    if (!client.roomId) {
      sendToClient(ws, {
        type: 'lobbyUpdate',
        rooms: summary
      });
    }
  }
}

function sanitizeAccount(acc) {
  if (!acc) return null;
  return {
    username: acc.username,
    avatar: acc.avatar || '🦁',
    bankroll: acc.bankroll,
    lastBonusClaim: acc.lastBonusClaim || 0,
    handsWon: acc.handsWon || 0,
    handsPlayed: acc.handsPlayed || 0
  };
}

// Sentar jogador com Buy-in escolhido
function sitPlayerInRoom(room, client, targetSeatIndex = -1, requestedBuyIn = null) {
  if (!client.username) return { success: false, message: 'Faça login primeiro!' };
  const userKey = client.username.toLowerCase();
  const acc = accounts[userKey];
  if (!acc) return { success: false, message: 'Conta não encontrada.' };

  if (room.handInProgress) return { success: false, message: 'Mão em andamento. Aguarde o término para entrar.' };
  if (client.seatIndex !== -1) return { success: false, message: 'Você já está sentado.' };
  const minB = room.minBuyIn;
  const maxB = room.maxBuyIn;

  if (acc.bankroll < minB) {
    return { success: false, message: `Você precisa de pelo menos $${minB.toLocaleString('pt-BR')} fichas para entrar nesta mesa. Resgate o bônus ou escolha outra mesa!` };
  }

  let buyIn = requestedBuyIn !== null ? requestedBuyIn : room.defaultBuyIn;
  if (!Number.isSafeInteger(buyIn) || buyIn < minB || buyIn > maxB || buyIn > acc.bankroll)
    return { success: false, message: 'Buy-in inválido ou saldo insuficiente.' };



  if (!Number.isInteger(targetSeatIndex)) return { success: false, message: 'Assento inválido.' };
  let seatIdx = targetSeatIndex;
  if (seatIdx < 0 || seatIdx >= NUM_SEATS || (room.seats[seatIdx] && !room.seats[seatIdx].isBot)) {
    if (!room.seats[0] || room.seats[0].isBot) {
      seatIdx = 0;
    } else {
      seatIdx = -1;
      for (let i = 0; i < NUM_SEATS; i++) {
        if (!room.seats[i] || room.seats[i].isBot) {
          seatIdx = i;
          break;
        }
      }
    }
  }

  if (seatIdx === -1) {
    return { success: false, message: 'A mesa está cheia de jogadores humanos!' };
  }

  acc.bankroll -= buyIn;

  client.seatIndex = seatIdx;
  room.seats[seatIdx] = {
    id: client.id,
    username: acc.username,
    name: acc.username,
    avatar: acc.avatar || '🦁',
    chips: buyIn,
    isBot: false,
    cards: [],
    currentBet: 0,
    folded: false,
    isAllIn: false,
    lastAction: ''
  };

  saveAccounts();
  return { success: true, seatIndex: seatIdx, buyIn };
}

function leaveCurrentRoom(ws) {
  const client = clients.get(ws);
  if (!client || !client.roomId) return;
  const room = rooms.get(client.roomId);
  const seat = room?.seats[client.seatIndex];
  if (seat?.id === client.id) {
    const acc = accounts[seat.username.toLowerCase()];
    acc.bankroll += seat.chips;
    seat.chips = 0;
    seat.departed = true;
    seat.folded = true;
    seat.cards = [];
    if (!room.handInProgress || room.stage === 'showdown') room.seats[client.seatIndex] = null;
    else {
      room.pendingActions?.delete(client.seatIndex);
      checkGameContinuation(room);
    }
    saveAccounts();
    sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
    broadcastRoom(room);
  }
  client.roomId = null;
  client.seatIndex = -1;
  broadcastLobby();
}

function attachAccount(ws, key) {
  const client = clients.get(ws);
  for (const [oldWs, old] of clients) {
    if (oldWs === ws || old.username?.toLowerCase() !== key) continue;
    if (!old.disconnected) {
      sendToClient(ws, { type: 'authError', message: 'Esta conta já está conectada em outra aba.' });
      return false;
    }
    cancelTask(old.disconnectTimer);
    Object.assign(client, { id: old.id, roomId: old.roomId, seatIndex: old.seatIndex });
    clients.delete(oldWs);
  }
  client.username = accounts[key].username;
  return true;
}

function sendRestoredRoom(ws) {
  const client = clients.get(ws);
  sendToClient(ws, { type: 'init', clientId: client.id, rooms: getRoomsSummary() });
  if (client.roomId) sendToClient(ws, { type: 'joinedRoom', roomId: client.roomId,
    table: getSanitizedTable(rooms.get(client.roomId), client.id) });
}

function handleClientMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client || !msg || typeof msg !== 'object') return;
  if (['register', 'login', 'tokenAuth'].includes(msg.type) && client.username) return;
  if (!['register', 'login', 'tokenAuth'].includes(msg.type) && !client.username) return;

  // 1. Cadastrar Conta (Username + Senha)
  if (msg.type === 'register') {
    const rawUser = (typeof msg.username === 'string' ? msg.username : '').trim();
    const rawPass = (typeof msg.password === 'string' ? msg.password : '').trim();
    const avatar = typeof msg.avatar === 'string' && msg.avatar.length <= 100 ? msg.avatar : '🦁';

    if (rawUser.length < 3 || rawUser.length > 30) {
      sendToClient(ws, { type: 'authError', message: 'O nome de usuário deve ter pelo menos 3 caracteres.' });
      return;
    }
    if (rawPass.length < 4 || rawPass.length > 128) {
      sendToClient(ws, { type: 'authError', message: 'A senha deve ter pelo menos 4 caracteres.' });
      return;
    }

    const key = rawUser.toLowerCase();
    if (accounts[key]) {
      sendToClient(ws, { type: 'authError', message: 'Este nome de usuário já existe. Faça login ou escolha outro nome!' });
      return;
    }

    // Se for o usuário especial "Gabriel", ganha 100 bilhões de fichas; senão, 50.000 fichas
    const startingChips = (key === 'gabriel') ? USER_VIP_CHIPS : DEFAULT_START_CHIPS;

    const salt = crypto.randomBytes(16).toString('hex');
    const newAcc = {
      username: rawUser,
      avatar,
      salt,
      passwordHash: hashPassword(rawPass, salt),
      bankroll: startingChips,
      lastBonusClaim: 0,
      handsWon: 0,
      handsPlayed: 0
    };

    accounts[key] = newAcc;
    saveAccounts();

    const token = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(token, key);
    client.username = rawUser;

    sendToClient(ws, {
      type: 'authSuccess',
      token,
      account: sanitizeAccount(newAcc)
    });
    broadcastLobby();
  }

  // 2. Login com Senha
  else if (msg.type === 'login') {
    const rawUser = (typeof msg.username === 'string' ? msg.username : '').trim();
    const rawPass = (typeof msg.password === 'string' ? msg.password : '').trim();
    const key = rawUser.toLowerCase();
    const acc = accounts[key];

    if (!acc) {
      sendToClient(ws, { type: 'authError', message: 'Usuário não encontrado. Clique em Cadastrar para criar sua conta!' });
      return;
    }

    const checkHash = hashPassword(rawPass, acc.salt);
    if (checkHash !== acc.passwordHash) {
      sendToClient(ws, { type: 'authError', message: 'Senha incorreta!' });
      return;
    }

    if (!attachAccount(ws, key)) return;

    const token = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(token, key);
    client.username = acc.username;

    sendToClient(ws, {
      type: 'authSuccess',
      token,
      account: sanitizeAccount(acc)
    });
    sendRestoredRoom(ws);
    broadcastLobby();
  }

  // 3. Login Automático com Token
  else if (msg.type === 'tokenAuth') {
    const key = sessionTokens.get(msg.token);
    if (key && accounts[key]) {
      const acc = accounts[key];
      if (!attachAccount(ws, key)) return;
      sendToClient(ws, {
        type: 'authSuccess',
        token: msg.token,
        account: sanitizeAccount(acc)
      });
      sendRestoredRoom(ws);
    } else {
      sendToClient(ws, { type: 'tokenExpired' });
    }
  }

  // 4. Logout
  else if (msg.type === 'logout') {
    if (client.roomId) leaveCurrentRoom(ws);
    for (const [token, key] of sessionTokens) if (key === client.username?.toLowerCase()) sessionTokens.delete(token);
    client.username = null;
    sendToClient(ws, { type: 'loggedOut' });
  }

  // 5. Resgate de Bônus (+10.000 fichas a cada 4 horas)
  else if (msg.type === 'claimBonus') {
    if (!client.username) return;
    const key = client.username.toLowerCase();
    const acc = accounts[key];
    if (!acc) return;

    const now = Date.now();
    const lastClaim = acc.lastBonusClaim || 0;
    const elapsed = now - lastClaim;

    if (elapsed < BONUS_COOLDOWN_MS) {
      const waitMinutes = Math.ceil((BONUS_COOLDOWN_MS - elapsed) / 60000);
      sendToClient(ws, {
        type: 'alert',
        message: `Bônus disponível em ${waitMinutes} minutos.`
      });
      return;
    }

    acc.bankroll += BONUS_AMOUNT;
    acc.lastBonusClaim = now;
    saveAccounts();

    sendToClient(ws, {
      type: 'accountUpdate',
      account: sanitizeAccount(acc)
    });
    sendToClient(ws, {
      type: 'alert',
      message: `🎉 Bônus de +$${BONUS_AMOUNT.toLocaleString('pt-BR')} fichas adicionado com sucesso!`
    });
  }

  // 6. Criar Mesa com Buy-in Ajustável
  else if (msg.type === 'createRoom') {
    if (!['easy', 'medium', 'hard'].includes(msg.botDifficulty) || !['slow', 'normal', 'fast'].includes(msg.botSpeed)) {
      sendToClient(ws, { type: 'alert', message: 'Dificuldade ou velocidade inválida.' });
      return;
    }
    const minB = (typeof msg.minBuyIn === 'number' ? msg.minBuyIn : NaN), maxB = (typeof msg.maxBuyIn === 'number' ? msg.maxBuyIn : NaN), defB = (typeof msg.defaultBuyIn === 'number' ? msg.defaultBuyIn : NaN);
    if (![minB, maxB, defB].every(Number.isSafeInteger) || minB < BIG_BLIND * 10 ||
        maxB < minB || maxB > 1000000000 || defB < minB || defB > maxB) {
      sendToClient(ws, { type: 'alert', message: 'Limites inválidos: mínimo 2.000; buy-in padrão dentro dos limites.' });
      return;
    }

    const newRoom = createRoom({
      name: typeof msg.name === 'string' ? msg.name.slice(0, 80) : 'Mesa MAXpoker',
      botDifficulty: msg.botDifficulty || 'medium',
      botSpeed: msg.botSpeed || 'normal',
      autoFillBots: !!msg.autoFillBots,
      minBuyIn: minB,
      maxBuyIn: maxB,
      defaultBuyIn: defB
    });
    broadcastLobby();
    joinRoom(ws, newRoom.id, (msg.playerBuyIn == null ? defB : (typeof msg.playerBuyIn === 'number' ? msg.playerBuyIn : NaN)));
  }

  // 7. Entrar na Mesa com Buy-in
  else if (msg.type === 'joinRoom') {
    joinRoom(ws, msg.roomId, msg.buyInAmount == null ? null : (typeof msg.buyInAmount === 'number' ? msg.buyInAmount : NaN));
  }

  // 8. Sair da Mesa
  else if (msg.type === 'leaveRoom') {
    leaveCurrentRoom(ws);
    const acc = client.username ? accounts[client.username.toLowerCase()] : null;
    sendToClient(ws, {
      type: 'leftRoom',
      rooms: getRoomsSummary(),
      account: acc ? sanitizeAccount(acc) : null
    });
  }

  // 9. Sentar
  else if (msg.type === 'sit') {
    if (!client.roomId) return;
    const room = rooms.get(client.roomId);
    if (!room) return;

    const res = sitPlayerInRoom(room, client, msg.seatIndex, msg.buyIn);
    if (!res.success) {
      sendToClient(ws, { type: 'alert', message: res.message });
      return;
    }

    const acc = accounts[client.username.toLowerCase()];
    sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
    broadcastRoom(room, `${acc.username} sentou com $${res.buyIn.toLocaleString('pt-BR')} fichas.`);
    checkGameStart(room);
    broadcastLobby();
  }

  // 10. Ações de Jogo
  else if (msg.type === 'action') {
    if (!client.roomId) return;
    const room = rooms.get(client.roomId);
    if (room && room.currentTurnSeat === client.seatIndex) {
      if (!handlePlayerAction(room, client.seatIndex, msg.action, msg.amount)) {
        sendToClient(ws, { type: 'alert', message: 'Ação inválida. Confira o valor e sua vez.' });
        sendToClient(ws, { type: 'tableUpdate', table: getSanitizedTable(room, client.id) });
      }
    }
  }
}

function joinRoom(ws, roomId, buyInAmount = null) {
  const client = clients.get(ws);
  if (!client) return;

  const room = rooms.get(roomId);
  if (!room) {
    sendToClient(ws, { type: 'alert', message: 'Mesa não encontrada.' });
    return;
  }

  if (client.roomId) { sendToClient(ws, { type: 'alert', message: 'Saia da mesa atual primeiro.' }); return; }

  const sitRes = sitPlayerInRoom(room, client, -1, buyInAmount);
  if (!sitRes.success) {
    sendToClient(ws, { type: 'alert', message: sitRes.message });
    return;
  }

  client.roomId = roomId;
  sendToClient(ws, {
    type: 'joinedRoom',
    roomId: room.id,
    table: getSanitizedTable(room, client.id)
  });

  const acc = accounts[client.username.toLowerCase()];
  if (acc) {
    sendToClient(ws, { type: 'accountUpdate', account: sanitizeAccount(acc) });
  }

  broadcastRoom(room, `${client.username} entrou na mesa!`);
  checkGameStart(room);
  broadcastLobby();
}

function fillBots(room) {
  if (room.handInProgress) return;
  let botIndex = 0;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (!room.seats[i]) {
      const botName = BOT_NAMES[botIndex % BOT_NAMES.length];
      const botAvatar = BOT_AVATARS[botIndex % BOT_AVATARS.length];
      botIndex++;
      room.seats[i] = {
        id: 'bot_' + Math.random().toString(36).substring(2, 7),
        name: botName,
        avatar: botAvatar,
        chips: room.defaultBuyIn,
        isBot: true,
        cards: [],
        currentBet: 0,
        folded: false,
        isAllIn: false,
        lastAction: ''
      };
    }
  }
}

function removeBots(room) {
  if (room.handInProgress) return;
  for (let i = 0; i < NUM_SEATS; i++) {
    if (room.seats[i]?.isBot) {
      room.seats[i] = null;
    }
  }
}

function getSanitizedTable(room, clientId) {
  const showAll = room.stage === 'showdown';
  const seatsCopy = room.seats.map(seat => {
    if (!seat) return null;
    const isOwner = seat.id === clientId;
    return {
      id: seat.id,
      name: seat.name,
      avatar: seat.avatar || (seat.isBot ? '🤖' : '🦁'),
      chips: seat.chips,
      isBot: seat.isBot,
      currentBet: seat.currentBet,
      folded: seat.folded,
      isAllIn: seat.isAllIn,
      canRaise: seat.actedAtBet == null || room.currentBet - seat.actedAtBet >= room.minRaise,
      lastAction: seat.lastAction,
      cards: seat.cards.map(c => {
        if (seat.folded) return { hidden: true };
        if (showAll || isOwner) return c;
        return { hidden: true };
      })
    };
  });

  return {
    roomId: room.id,
    roomName: room.name,
    botDifficulty: room.botDifficulty,
    botSpeed: room.botSpeed,
    autoFillBots: room.autoFillBots,
    minBuyIn: room.minBuyIn,
    maxBuyIn: room.maxBuyIn,
    defaultBuyIn: room.defaultBuyIn,
    seats: seatsCopy,
    pot: room.pot,
    communityCards: room.communityCards,
    stage: room.stage,
    dealerSeat: room.dealerSeat,
    currentTurnSeat: room.currentTurnSeat,
    currentBet: room.currentBet,
    minRaise: room.minRaise,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    handInProgress: room.handInProgress,
    statusMsg: room.statusMsg,
    lastWinners: room.lastWinners || null
  };
}

function broadcastRoom(room, statusMsg = null) {
  if (statusMsg) room.statusMsg = statusMsg;
  for (const [ws, client] of clients.entries()) {
    if (client.roomId === room.id) {
      sendToClient(ws, {
        type: 'tableUpdate',
        table: getSanitizedTable(room, client.id)
      });
    }
  }
}

function sendToClient(ws, data) {
  if (deliveries) { deliveries.push([ws, JSON.stringify(data)]); return; }
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ==========================================
// Mecânica do Texas Hold'em com Ritmo e Tempo
// ==========================================
function getSeatedPlayers(room) {
  return room.seats.map((s, idx) => ({ ...s, seatIndex: idx })).filter(s => s.id && s.chips > 0);
}

function nextSeat(room, index) {
  let count = 0;
  let curr = (index + 1) % NUM_SEATS;
  while (count < NUM_SEATS) {
    if (room.seats[curr] && room.seats[curr].chips > 0 && !room.seats[curr].folded) {
      return curr;
    }
    curr = (curr + 1) % NUM_SEATS;
    count++;
  }
  return -1;
}

function checkGameStart(room) {
  if (room.handInProgress) return;

  if (room.autoFillBots) {
    fillBots(room);
  }

  const seated = getSeatedPlayers(room);
  if (seated.length >= 2) {
    room.statusMsg = 'Embaralhando cartas...';
    broadcastRoom(room);
    cancelTask(room.timer);
    room.timer = scheduleTask(() => {
      if (!room.handInProgress && getSeatedPlayers(room).length >= 2) {
        startNewHand(room);
      }
    }, 2500);
  }
}

function checkGameContinuation(room) {
  if (room.handInProgress && room.stage !== 'showdown') {
    if (contenders(room).length <= 1 || room.seats[room.currentTurnSeat]?.departed) advanceTurn(room);
  }
  else if (!room.handInProgress) checkGameStart(room);
}

function contenders(room) {
  return room.seats.filter(s => s && !s.folded && s.cards.length === 2);
}

function startNewHand(room) {
  if (getSeatedPlayers(room).length < 2) return;
  cancelTask(room.streetTimer);
  cancelTask(room.actionTimer);
  room.handInProgress = true;
  room.deck = createCryptoShuffledDeck();
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
  room.stage = 'preflop';
  room.lastWinners = null;
  room.pendingActions = new Set();
  for (let i = 0; i < NUM_SEATS; i++) {
    const seat = room.seats[i];
    if (!seat) continue;
    Object.assign(seat, { cards: [], currentBet: 0, totalBet: 0, folded: true,
      isAllIn: false, lastAction: '', actedAtBet: null });
    if (seat.chips <= 0 || seat.departed) continue;
    seat.cards = [room.deck.pop(), room.deck.pop()];
    seat.folded = false;
    room.pendingActions.add(i);
    if (!seat.isBot) accounts[seat.username.toLowerCase()].handsPlayed++;
  }
  room.dealerSeat = nextSeat(room, room.dealerSeat);
  const sb = room.pendingActions.size === 2 ? room.dealerSeat : nextSeat(room, room.dealerSeat);
  const bb = nextSeat(room, sb);
  postBet(room, sb, SMALL_BLIND, 'Small Blind');
  postBet(room, bb, BIG_BLIND, 'Big Blind');
  room.currentBet = BIG_BLIND;
  room.currentTurnSeat = bb;
  saveAccounts();
  advanceTurn(room);
}

function postBet(room, seatIdx, amount, actionName) {
  const seat = room.seats[seatIdx];
  const actual = Math.min(seat.chips, amount);
  seat.chips -= actual;
  seat.currentBet += actual;
  seat.totalBet = (seat.totalBet || 0) + actual;
  room.pot += actual;
  seat.isAllIn = seat.chips === 0;
  seat.lastAction = actionName;
}

function handlePlayerAction(room, seatIdx, action, raiseToAmount) {
  const seat = room.seats[seatIdx];
  if (!room.handInProgress || room.stage === 'showdown' || room.currentTurnSeat !== seatIdx ||
      !seat || seat.folded || seat.isAllIn || !room.pendingActions?.has(seatIdx)) return false;
  const toCall = Math.max(0, room.currentBet - seat.currentBet);
  if (!['fold', 'check', 'call', 'raise'].includes(action)) return false;
  if (action === 'check' && toCall > 0) return false;
  if (action === 'raise') {
    if (!Number.isSafeInteger(raiseToAmount) || raiseToAmount <= 0) return false;
    const target = Math.min(raiseToAmount, seat.chips + seat.currentBet);
    const increment = target - room.currentBet;
    const allIn = target === seat.chips + seat.currentBet;
    const canRaise = seat.actedAtBet == null || room.currentBet - seat.actedAtBet >= room.minRaise;
    if (!canRaise || increment <= 0 || (increment < room.minRaise && !allIn)) return false;
    const fullRaise = increment >= room.minRaise;
    postBet(room, seatIdx, target - seat.currentBet, 'Raise $' + target.toLocaleString('pt-BR'));
    room.currentBet = target;
    if (fullRaise) room.minRaise = increment;
    for (let i = 0; i < NUM_SEATS; i++) {
      const other = room.seats[i];
      if (i !== seatIdx && other && !other.folded && !other.isAllIn && other.cards.length === 2 &&
          other.currentBet < room.currentBet) room.pendingActions.add(i);
    }
  } else if (action === 'fold') {
    seat.folded = true;
    seat.cards = [];
    seat.lastAction = 'Fold';
  } else {
    postBet(room, seatIdx, Math.min(toCall, seat.chips), toCall ? 'Call' : 'Check');
  }
  cancelTask(room.actionTimer);
  cancelTask(room.botTimer);
  seat.actedAtBet = room.currentBet;
  room.pendingActions.delete(seatIdx);
  saveAccounts();
  advanceTurn(room);
  return true;
}

function advanceTurn(room) {
  if (!room.handInProgress || room.stage === 'showdown') return;
  const active = contenders(room);
  if (active.length <= 1) {
    if (active.length) awardPot(room, active[0]);
    else finishAwards(room, new Map(room.seats.filter(s => s && s.totalBet > 0).map(s => [s, s.totalBet])));
    return;
  }
  for (const i of room.pendingActions) {
    const seat = room.seats[i];
    if (!seat || seat.folded || seat.isAllIn || seat.cards.length !== 2) room.pendingActions.delete(i);
  }
  const able = active.filter(s => !s.isAllIn);
  if (able.length === 1 && able[0].currentBet >= room.currentBet) room.pendingActions.clear();
  if (!room.pendingActions.size) {
    room.currentTurnSeat = null;
    cancelTask(room.actionTimer);
    cancelTask(room.botTimer);
    cancelTask(room.streetTimer);
    broadcastRoom(room);
    room.streetTimer = scheduleTask(() => advanceStreet(room), getStreetPauseDelay(room.botSpeed));
    return;
  }
  let next = room.currentTurnSeat ?? room.dealerSeat;
  for (let n = 0; n < NUM_SEATS; n++) {
    next = (next + 1) % NUM_SEATS;
    if (room.pendingActions.has(next)) break;
  }
  room.currentTurnSeat = next;
  room.statusMsg = 'Vez de ' + room.seats[next].name;
  broadcastRoom(room);
  cancelTask(room.actionTimer);
  if (!room.seats[next].isBot) room.actionTimer = scheduleTask(() => {
    if (room.currentTurnSeat === next) handlePlayerAction(room, next,
      room.seats[next].currentBet === room.currentBet ? 'check' : 'fold');
  }, 30000);
  triggerBotTurnIfNeeded(room);
}

function advanceStreet(room) {
  if (!room.handInProgress || room.stage === 'showdown') return;
  if (contenders(room).length <= 1) { advanceTurn(room); return; }
  if (room.stage === 'river') { resolveShowdown(room); return; }
  room.pendingActions = new Set();
  for (let i = 0; i < NUM_SEATS; i++) {
    const seat = room.seats[i];
    if (!seat) continue;
    seat.currentBet = 0;
    seat.actedAtBet = null;
    if (!seat.folded) seat.lastAction = '';
    if (!seat.folded && !seat.isAllIn && seat.cards.length === 2) room.pendingActions.add(i);
  }
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
  room.deck.pop();
  if (room.stage === 'preflop') {
    room.stage = 'flop';
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else {
    room.stage = room.stage === 'flop' ? 'turn' : 'river';
    room.communityCards.push(room.deck.pop());
  }
  room.currentTurnSeat = room.dealerSeat;
  saveAccounts();
  advanceTurn(room);
}

function resolveShowdown(room) {
  const players = contenders(room);
  if (players.length === 1) { awardPot(room, players[0]); return; }
  const levels = [...new Set(room.seats.filter(Boolean).map(s => s.totalBet || 0))].filter(n => n > 0).sort((a,b) => a-b);
  const awards = new Map();
  let previous = 0;
  for (const level of levels) {
    const contributors = room.seats.filter(s => s && s.totalBet >= level);
    const amount = (level - previous) * contributors.length;
    previous = level;
    const eligible = players.filter(s => s.totalBet >= level);
    if (!eligible.length) {
      // Uncalled excess or an abandoned pot: return this layer to contributors.
      for (const seat of contributors) awards.set(seat, (awards.get(seat) || 0) + amount / contributors.length);
      continue;
    }
    let best = null, winners = [];
    for (const seat of eligible) {
      const hand = getBestHand([...seat.cards, ...room.communityCards]);
      const cmp = best ? compareScores(hand.score, best) : 1;
      if (cmp > 0) { best = hand.score; winners = [seat]; }
      else if (cmp === 0) winners.push(seat);
      seat.handName = hand.name;
    }
    winners.sort((a,b) => ((room.seats.indexOf(a)-room.dealerSeat+NUM_SEATS-1)%NUM_SEATS) - ((room.seats.indexOf(b)-room.dealerSeat+NUM_SEATS-1)%NUM_SEATS));
    const share = Math.floor(amount / winners.length);
    let remainder = amount % winners.length;
    for (const seat of winners) awards.set(seat, (awards.get(seat) || 0) + share + (remainder-- > 0 ? 1 : 0));
  }
  finishAwards(room, awards);
}

function finishAwards(room, awards) {
  room.lastWinners = [];
  for (const [seat, amount] of awards) {
    if (seat.departed) accounts[seat.username.toLowerCase()].bankroll += amount;
    else seat.chips += amount;
    if (!seat.folded) {
      if (!seat.isBot) accounts[seat.username.toLowerCase()].handsWon++;
      room.lastWinners.push({ seatIndex: room.seats.indexOf(seat), name: seat.name, amount, handName: seat.handName || 'Todos deram fold' });
    }
  }
  room.pot = 0;
  for (const seat of room.seats) if (seat) seat.totalBet = 0;
  room.statusMsg = room.lastWinners.map(w => w.name + ' ganhou $' + w.amount.toLocaleString('pt-BR')).join(' • ');
  endHand(room);
}

function awardPot(room, winner) {
  finishAwards(room, new Map([[winner, room.pot]]));
}

function endHand(room) {
  cancelTask(room.streetTimer);
  cancelTask(room.botTimer);
  cancelTask(room.actionTimer);
  room.stage = 'showdown';
  room.currentTurnSeat = null;
  saveAccounts();
  broadcastRoom(room);
  scheduleNextHand(room);
}

function scheduleNextHand(room) {
  cancelTask(room.timer);
  room.timer = scheduleTask(() => {
    room.handInProgress = false;
    room.stage = 'waiting';
    for (let i = 0; i < NUM_SEATS; i++) {
      const seat = room.seats[i];
      if (!seat) continue;
      if (seat.departed) room.seats[i] = null;
      else if (seat.chips <= 0) {
        if (seat.isBot) seat.chips = room.defaultBuyIn;
        else {
          room.seats[i] = null;
          for (const [ws, client] of clients) if (client.id === seat.id) {
            client.seatIndex = -1;
            client.roomId = null;
            sendToClient(ws, { type: 'leftRoom', rooms: getRoomsSummary(), account: sanitizeAccount(accounts[seat.username.toLowerCase()]) });
          }
        }
      }
    }
    saveAccounts();
    broadcastRoom(room);
    broadcastLobby();
    if (room.seats.some(s => s && !s.isBot)) checkGameStart(room);
  }, 4500);
}

function getBotThinkingDelay(speed) {
  if (speed === 'slow') return 2400 + Math.random() * 1000;
  if (speed === 'fast') return 900 + Math.random() * 400;
  return 1800 + Math.random() * 800;
}

function getStreetPauseDelay(speed) {
  if (speed === 'slow') return 1800;
  if (speed === 'fast') return 800;
  return 1400;
}

function performBotAction(room, seatIdx, action, amount) {
  if (!handlePlayerAction(room, seatIdx, action, amount)) handlePlayerAction(room, seatIdx, 'call');
}

function triggerBotTurnIfNeeded(room) {
  if (room.stage === 'showdown' || room.stage === 'waiting') return;
  const currentSeat = room.seats[room.currentTurnSeat];
  if (!currentSeat || !currentSeat.isBot) return;

  cancelTask(room.botTimer);
  const delay = getBotThinkingDelay(room.botSpeed);

  room.botTimer = scheduleTask(() => {
    if (room.currentTurnSeat === null) return;
    const bot = room.seats[room.currentTurnSeat];
    if (!bot || !bot.isBot) return;

    const toCall = room.currentBet - bot.currentBet;
    if (bot.actedAtBet != null && room.currentBet - bot.actedAtBet < room.minRaise) {
      performBotAction(room, room.currentTurnSeat, 'call');
      return;
    }
    const botFull = [...bot.cards, ...room.communityCards];
    const best = botFull.length >= 5 ? getBestHand(botFull) : null;
    const tier = best ? best.score[0] : 1;
    const diff = room.botDifficulty || 'medium';

    if (diff === 'easy') {
      if (toCall === 0) {
        if (tier >= 3 && Math.random() > 0.6) {
          performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise);
        } else {
          performBotAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 2 && toCall <= BIG_BLIND * 2) {
          performBotAction(room, room.currentTurnSeat, 'call');
        } else if (tier >= 3) {
          performBotAction(room, room.currentTurnSeat, 'call');
        } else {
          performBotAction(room, room.currentTurnSeat, 'fold');
        }
      }
    } else if (diff === 'hard') {
      if (toCall === 0) {
        if (tier >= 2 || Math.random() > 0.35) {
          const raiseSize = room.currentBet + room.minRaise * (Math.random() > 0.5 ? 2 : 1);
          performBotAction(room, room.currentTurnSeat, 'raise', raiseSize);
        } else {
          performBotAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 3) {
          if (Math.random() > 0.45) {
            performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise * 3);
          } else {
            performBotAction(room, room.currentTurnSeat, 'call');
          }
        } else if (tier === 2) {
          if (Math.random() > 0.75) {
            performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise * 2);
          } else {
            performBotAction(room, room.currentTurnSeat, 'call');
          }
        } else {
          if (toCall <= BIG_BLIND && Math.random() > 0.5) {
            performBotAction(room, room.currentTurnSeat, 'call');
          } else if (Math.random() > 0.7) {
            performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise * 2);
          } else {
            performBotAction(room, room.currentTurnSeat, 'fold');
          }
        }
      }
    } else {
      if (toCall === 0) {
        if (tier >= 2 && Math.random() > 0.4) {
          performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise);
        } else {
          performBotAction(room, room.currentTurnSeat, 'check');
        }
      } else {
        if (tier >= 3) {
          if (Math.random() > 0.6 && room.stage !== 'river') {
            performBotAction(room, room.currentTurnSeat, 'raise', room.currentBet + room.minRaise * 2);
          } else {
            performBotAction(room, room.currentTurnSeat, 'call');
          }
        } else if (tier === 2) {
          performBotAction(room, room.currentTurnSeat, 'call');
        } else {
          if (toCall <= BIG_BLIND * 2 && Math.random() > 0.4) {
            performBotAction(room, room.currentTurnSeat, 'call');
          } else {
            performBotAction(room, room.currentTurnSeat, 'fold');
          }
        }
      }
    }
  }, delay);
}

function listen() {
  storageReady = true;
  server.listen(PORT, () => console.log('MAXpoker online; armazenamento: ' + (DATABASE_URL ? 'PostgreSQL' : 'arquivo local')));
}

function stopForStorageFailure() {
  storageReady = false;
  deliveries = null;
  // Do not log connection strings, account contents or driver errors containing credentials.
  console.error('Persistência indisponível. Operação não confirmada; servidor será reiniciado.');
  for (const ws of clients.keys()) ws.terminate();
  process.exit(1);
}

async function startDatabase() {
  const { createPostgresStore, createDurableQueue } = require('./lib/postgres-store');
  databaseStore = createPostgresStore(DATABASE_URL, { onError: stopForStorageFailure });
  // Explicit opt-in import. Never silently resurrect stale accounts from Git.
  const seed = process.env.IMPORT_ACCOUNTS_FILE
    ? JSON.parse(fs.readFileSync(process.env.IMPORT_ACCOUNTS_FILE, 'utf8')) : {};
  Object.assign(accounts, normalizeAccounts(await databaseStore.load(seed)));
  saveAccounts();
  await databaseStore.save(accounts);
  databaseDirty = false;
  durableQueue = createDurableQueue({
    begin: () => { deliveries = []; },
    commit: async () => {
      if (databaseDirty) { await databaseStore.save(accounts); databaseDirty = false; }
    },
    publish: () => {
      const messages = deliveries;
      deliveries = null;
      for (const [ws, json] of messages) if (ws.readyState === ws.OPEN) ws.send(json);
    },
    fail: stopForStorageFailure
  });
  listen();
}

if (DATABASE_URL) startDatabase().catch(stopForStorageFailure);
else { saveAccounts(); listen(); }
