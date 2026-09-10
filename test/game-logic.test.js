'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDiceHand,
  getHandContribution,
  countBidDice,
  checkDiceBid,
  createDice,
  rerollDice,
  createRevolver,
  pullRevolver,
  revolverPublicState,
  aliveTurnIndex,
  validateCardSelection,
  validateQuickMessage,
  buildCardDeck,
  validateBidTransition
} = require('../game-logic');

test('识别普通骰、假豹子和真豹子', () => {
  assert.deepEqual(classifyDiceHand([2, 2, 1, 1, 1]), {
    kind: 'fake-leopard', face: 2, contribution: 6
  });
  assert.deepEqual(classifyDiceHand([6, 6, 6, 6, 1]), {
    kind: 'fake-leopard', face: 6, contribution: 6
  });
  assert.deepEqual(classifyDiceHand([4, 4, 4, 4, 4]), {
    kind: 'real-leopard', face: 4, contribution: 7
  });
  assert.equal(classifyDiceHand([2, 1, 1, 1, 1]).kind, 'ordinary');
  assert.equal(classifyDiceHand([2, 2, 3, 1, 1]).kind, 'ordinary');
});

test('轮盘为每位玩家保存真实弹巢进度，且不向前端泄露子弹位置', () => {
  let revolver = createRevolver(() => 0.49);
  assert.deepEqual(revolver, { bulletAt: 3, pulls: 0 });
  assert.deepEqual(revolverPublicState(revolver), { chambers: 6, remaining: 6 });

  let result = pullRevolver(revolver);
  assert.equal(result.isShot, false);
  assert.equal(result.remaining, 5);
  revolver = result.revolver;

  result = pullRevolver(revolver);
  assert.equal(result.isShot, false);
  revolver = result.revolver;

  result = pullRevolver(revolver);
  assert.equal(result.isShot, true);
  assert.equal(result.remaining, 3);
  assert.deepEqual(revolverPublicState(result.revolver), { chambers: 6, remaining: 3 });
  assert.equal('bulletAt' in revolverPublicState(result.revolver), false);
});

test('当前玩家出局后回合自动顺延到下一位存活玩家', () => {
  const players = [
    { id: 'a', alive: true },
    { id: 'b', alive: false },
    { id: 'c', alive: false },
    { id: 'd', alive: true }
  ];
  assert.equal(aliveTurnIndex(players, 1), 3);
  assert.equal(aliveTurnIndex(players, 3), 3);
  assert.equal(aliveTurnIndex(players, 6), 3);
  assert.equal(aliveTurnIndex(players.map((player) => ({ ...player, alive: false })), 1), -1);
});

test('恶魔牌必须单出，服务端拒绝任何混出组合', () => {
  assert.deepEqual(validateCardSelection(['devil']), { valid: true, reason: '' });
  assert.equal(validateCardSelection(['devil', 'sun']).valid, false);
  assert.equal(validateCardSelection(['moon', 'devil', 'joker']).valid, false);
  assert.match(validateCardSelection(['devil', 'star']).reason, /不能与其他牌混出/);
  assert.equal(validateCardSelection(['sun', 'moon', 'star']).valid, true);
});

test('快捷语言只允许服务端固定列表中的短句与表情', () => {
  assert.deepEqual(validateQuickMessage(' 开我啊 '), { valid: true, text: '开我啊', reason: '' });
  assert.equal(validateQuickMessage('😈').valid, true);
  assert.equal(validateQuickMessage('<script>alert(1)</script>').valid, false);
  assert.match(validateQuickMessage('自定义文本').reason, /快捷语言列表/);
});

test('卡牌小轮使用 6/6/6/2 基础牌库并随机替换一张普通牌为恶魔', () => {
  const deck = buildCardDeck(() => 0);
  const count = (card) => deck.filter((item) => item === card).length;
  assert.equal(deck.length, 20);
  assert.equal(count('devil'), 1);
  assert.equal(count('joker'), 2);
  assert.equal(count('sun') + count('star') + count('moon'), 17);
  assert.deepEqual([count('sun'), count('star'), count('moon')].sort(), [5, 6, 6]);
});

test('普通骰在飞时将 1 当万能数，摘后只按实际点数计算', () => {
  const hand = [1, 1, 3, 4, 6];
  assert.equal(getHandContribution(hand, 3, true), 3);
  assert.equal(getHandContribution(hand, 3, false), 1);
  assert.equal(getHandContribution(hand, 1, true), 2);
  assert.equal(getHandContribution(hand, 1, false), 2);
});

test('假豹子的本点始终计 6，真豹子的本点始终计 7', () => {
  assert.equal(getHandContribution([3, 3, 1, 1, 1], 3, true), 6);
  assert.equal(getHandContribution([3, 3, 1, 1, 1], 3, false), 6);
  assert.equal(getHandContribution([5, 5, 5, 5, 5], 5, false), 7);
  assert.equal(getHandContribution([1, 1, 1, 1, 1], 1, false), 7);
  assert.equal(getHandContribution([1, 1, 1, 1, 1], 4, true), 7);
  assert.equal(getHandContribution([1, 1, 1, 1, 1], 4, false), 0);
});

test('汇总时忽略已出局玩家，并返回质疑所需总数', () => {
  const players = [
    { alive: true, dice: [2, 2, 1, 1, 1] },
    { alive: true, dice: [2, 3, 4, 5, 6] },
    { alive: false, dice: [2, 2, 2, 2, 2] }
  ];
  assert.equal(countBidDice(players, 2, false), 7);
  assert.deepEqual(checkDiceBid(players, 7, 2, false), { valid: true, total: 7 });
  assert.deepEqual(checkDiceBid(players, 8, 2, false), { valid: false, total: 7 });
});

test('骰子生成和每轮重摇可注入确定性随机数', () => {
  const values = [0, 0.16, 0.34, 0.5, 0.999];
  assert.deepEqual(createDice(() => values.shift()), [1, 1, 3, 4, 6]);

  const players = [
    { id: 'a', alive: true, dice: [6, 6, 6, 6, 6] },
    { id: 'b', alive: false, dice: [2, 2, 2, 2, 2] }
  ];
  const rerolled = rerollDice(players, () => 0);
  assert.deepEqual(rerolled[0].dice, [1, 1, 1, 1, 1]);
  assert.deepEqual(rerolled[1].dice, [2, 2, 2, 2, 2]);
  assert.notStrictEqual(rerolled, players);
  assert.deepEqual(players[0].dice, [6, 6, 6, 6, 6]);
});

test('首报合法，报 1 会自动进入摘状态', () => {
  assert.deepEqual(validateBidTransition(null, { quantity: 1, face: 6 }), {
    valid: true, reason: '', nextOnesWild: true, transition: 'initial-wild'
  });
  assert.equal(
    validateBidTransition(null, { quantity: 2, face: 1 }).nextOnesWild,
    false
  );
  assert.equal(
    validateBidTransition(null, { quantity: 2, face: 3, exact: true }).nextOnesWild,
    false
  );
});

test('飞行状态下可按上一数量的一半向上取整进行摘', () => {
  const previous = { quantity: 3, face: 6 };
  assert.equal(
    validateBidTransition(previous, { quantity: 2, face: 1 }, true).valid,
    true
  );
  assert.equal(
    validateBidTransition(previous, { quantity: 2, face: 2, exact: true }, true).valid,
    true
  );
  const tooLow = validateBidTransition(previous, { quantity: 1, face: 2, exact: true }, true);
  assert.equal(tooLow.valid, false);
  assert.match(tooLow.reason, /不能少于 2/);
});

test('摘状态按普通次序加注，显式翻倍飞回万能状态', () => {
  const previous = { quantity: 2, face: 1 };
  assert.equal(validateBidTransition(previous, { quantity: 3, face: 1 }, false).valid, true);
  assert.equal(validateBidTransition(previous, { quantity: 2, face: 2 }, false).valid, true);

  const flew = validateBidTransition(previous, { quantity: 4, face: 2, fly: true }, false);
  assert.deepEqual(flew, {
    valid: true, reason: '', nextOnesWild: true, transition: 'fly'
  });
  const shortFly = validateBidTransition(previous, { quantity: 3, face: 6, fly: true }, false);
  assert.equal(shortFly.valid, false);
  assert.match(shortFly.reason, /不能少于 4/);
});

test('拒绝倒退报价和无意义的摘飞操作，并给出中文原因', () => {
  assert.match(
    validateBidTransition({ quantity: 3, face: 4 }, { quantity: 3, face: 3 }, true).reason,
    /必须增加/
  );
  assert.match(
    validateBidTransition(null, { quantity: 1, face: 2, fly: true }, true).reason,
    /首个报价/
  );
  assert.match(
    validateBidTransition({ quantity: 2, face: 2 }, { quantity: 4, face: 3, fly: true }, true).reason,
    /已经是万能数/
  );
  assert.match(
    validateBidTransition({ quantity: 2, face: 2 }, { quantity: 3, face: 3, exact: true }, false).reason,
    /已经是“摘”状态/
  );
  assert.match(
    validateBidTransition({ quantity: 2, face: 1 }, { quantity: 4, face: 1, fly: true }, false).reason,
    /只能报价 2 到 6 点/
  );
});
