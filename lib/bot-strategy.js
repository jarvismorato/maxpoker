function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta) return delta;
  }
  return 0;
}

// Sample only unseen cards. No opponent hole cards or actual draw deck are accepted.
function estimateEquity(cards, board, opponents, evaluate, random = Math.random, trials = 80) {
  const known = new Set([...cards, ...board].map(c => c.value + c.suit));
  const unknown = [];
  for (const suit of ['♠', '♥', '♦', '♣']) for (let value = 2; value <= 14; value++) {
    if (!known.has(value + suit)) unknown.push({ value, suit });
  }
  let equity = 0;
  for (let trial = 0; trial < trials; trial++) {
    const pool = unknown.slice();
    const draw = () => pool.splice(Math.floor(random() * pool.length), 1)[0];
    const completed = board.slice();
    while (completed.length < 5) completed.push(draw());
    const mine = evaluate([...cards, ...completed]);
    let ties = 1, beaten = false;
    for (let i = 0; i < opponents; i++) {
      const score = evaluate([draw(), draw(), ...completed]);
      const result = compare(score, mine);
      if (result > 0) { beaten = true; break; }
      if (result === 0) ties++;
    }
    if (!beaten) equity += 1 / ties;
  }
  return equity / trials;
}

function chooseBotAction(view, evaluate, random = Math.random) {
  const { cards, board, pot, currentBet, myBet, chips, minRaise, bigBlind } = view;
  const toCall = Math.max(0, Math.min(view.toCall, chips));
  const passive = () => ({ action: toCall > 0 ? 'call' : 'check' });
  const raise = fraction => {
    if (view.canRaise === false) return passive();
    const amount = Math.min(myBet + chips, currentBet + Math.max(minRaise, Math.round((pot + toCall) * fraction)));
    return amount > currentBet ? { action: 'raise', amount } : passive();
  };
  if (view.difficulty === 'easy') {
    const pair = cards[0].value === cards[1].value;
    const high = Math.max(...cards.map(c => c.value));
    const suited = cards[0].suit === cards[1].suit;
    const connected = Math.abs(cards[0].value - cards[1].value) <= 2;
    const tier = board.length ? evaluate([...cards, ...board])[0] : 1;
    const promising = board.length ? tier >= 2 : pair || high >= 11 || (suited && connected);
    if (!toCall) return ((pair && !board.length) || tier >= 3) && random() < 0.2 ? raise(0.35) : passive();
    const cheap = toCall <= bigBlind * 2 && toCall <= Math.max(bigBlind, pot * 0.3);
    if (cheap && (promising || random() < 0.8)) return passive();
    if (promising && toCall <= Math.max(bigBlind * 2, pot * 0.5)) return passive();
    if (tier >= 3 && toCall <= pot) return passive();
    return { action: 'fold' };
  }
  const equity = estimateEquity(cards, board, Math.max(1, view.opponents), evaluate, random);
  const odds = toCall / Math.max(1, pot + toCall);
  const valueThreshold = Math.max(0.48, 1 / (view.opponents + 1) + 0.22);
  if (equity > valueThreshold && equity > odds + 0.15 && random() < 0.8) return raise(equity > 0.8 ? 0.9 : 0.6);
  if (!toCall) return random() < 0.06 ? raise(0.5) : passive();
  return equity + 0.03 >= odds ? passive() : { action: 'fold' };
}

module.exports = { chooseBotAction, estimateEquity };
