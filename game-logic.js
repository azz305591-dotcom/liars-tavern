'use strict';

const DICE_PER_HAND = 5;
const REVOLVER_CHAMBERS = 6;

function assertFace(face) {
  if (!Number.isInteger(face) || face < 1 || face > 6) {
    throw new RangeError('骰子点数必须是 1 到 6 的整数');
  }
}

function assertHand(dice) {
  if (!Array.isArray(dice) || dice.length !== DICE_PER_HAND) {
    throw new TypeError('每手必须正好包含 5 颗骰子');
  }
  dice.forEach(assertFace);
}

/**
 * 豹子只描述一位玩家的一手骰子，与当前是否处于“摘”状态无关。
 */
function classifyDiceHand(dice) {
  assertHand(dice);

  const first = dice[0];
  if (dice.every((die) => die === first)) {
    return { kind: 'real-leopard', face: first, contribution: 7 };
  }

  const nonOnes = dice.filter((die) => die !== 1);
  if (
    nonOnes.length >= 2 &&
    nonOnes.length <= 4 &&
    nonOnes.every((die) => die === nonOnes[0])
  ) {
    return { kind: 'fake-leopard', face: nonOnes[0], contribution: 6 };
  }

  return { kind: 'ordinary', face: null, contribution: null };
}

/**
 * 计算单手对某个报价点数的贡献。
 * 豹子的奖励仅作用于豹子的那个点数；其他点数仍按普通规则计数。
 */
function getHandContribution(dice, bidFace, onesWild = true) {
  assertHand(dice);
  assertFace(bidFace);

  const classification = classifyDiceHand(dice);
  if (classification.face === bidFace) {
    return classification.contribution;
  }

  // 五个 1 是真豹子：飞行状态下，它对任意非 1 点数贡献 7。
  if (
    classification.kind === 'real-leopard' &&
    classification.face === 1 &&
    bidFace !== 1 &&
    onesWild
  ) {
    return 7;
  }

  let total = dice.filter((die) => die === bidFace).length;
  if (onesWild && bidFace !== 1) {
    total += dice.filter((die) => die === 1).length;
  }
  return total;
}

function getHands(diceSources) {
  if (!Array.isArray(diceSources)) {
    throw new TypeError('玩家或骰子手牌列表必须是数组');
  }

  return diceSources
    .filter((source) => Array.isArray(source) || source.alive !== false)
    .map((source) => (Array.isArray(source) ? source : source.dice));
}

function countBidDice(diceSources, bidFace, onesWild = true) {
  return getHands(diceSources).reduce(
    (total, dice) => total + getHandContribution(dice, bidFace, onesWild),
    0
  );
}

function checkDiceBid(diceSources, quantity, face, onesWild = true) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new RangeError('报价数量必须是正整数');
  }
  const total = countBidDice(diceSources, face, onesWild);
  return { valid: total >= quantity, total };
}

function createDice(rng = Math.random, count = DICE_PER_HAND) {
  if (typeof rng !== 'function') throw new TypeError('随机数生成器必须是函数');
  if (!Number.isInteger(count) || count < 1) throw new RangeError('骰子数量必须是正整数');

  return Array.from({ length: count }, () => {
    const randomValue = rng();
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError('随机数生成器必须返回 [0, 1) 范围内的数');
    }
    return Math.floor(randomValue * 6) + 1;
  });
}

/**
 * 返回新的玩家数组；出局玩家及原对象都不会被修改。
 */
function rerollDice(players, rng = Math.random) {
  if (!Array.isArray(players)) throw new TypeError('玩家列表必须是数组');
  return players.map((player) => (
    player.alive === false ? { ...player } : { ...player, dice: createDice(rng) }
  ));
}

function createRevolver(rng = Math.random) {
  if (typeof rng !== 'function') throw new TypeError('随机数生成器必须是函数');
  const randomValue = rng();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('随机数生成器必须返回 [0, 1) 范围内的数');
  }
  return { bulletAt: Math.floor(randomValue * REVOLVER_CHAMBERS) + 1, pulls: 0 };
}

function pullRevolver(revolver) {
  if (!revolver || !Number.isInteger(revolver.bulletAt) || revolver.bulletAt < 1 || revolver.bulletAt > REVOLVER_CHAMBERS) {
    throw new TypeError('弹巢状态无效');
  }
  const pulls = Math.min(REVOLVER_CHAMBERS, (Number.isInteger(revolver.pulls) ? revolver.pulls : 0) + 1);
  return {
    revolver: { bulletAt: revolver.bulletAt, pulls },
    isShot: pulls >= revolver.bulletAt,
    remaining: Math.max(0, REVOLVER_CHAMBERS - pulls)
  };
}

function revolverPublicState(revolver) {
  const pulls = revolver && Number.isInteger(revolver.pulls) ? revolver.pulls : 0;
  return { chambers: REVOLVER_CHAMBERS, remaining: Math.max(0, REVOLVER_CHAMBERS - pulls) };
}

function readBid(bid) {
  if (Array.isArray(bid)) return { quantity: bid[0], face: bid[1] };
  if (bid && typeof bid === 'object') {
    return { quantity: bid.quantity ?? bid.count, face: bid.face };
  }
  return null;
}

function invalid(reason, onesWild) {
  return { valid: false, reason, nextOnesWild: onesWild, transition: 'invalid' };
}

/**
 * 校验一次报价与摘/飞状态迁移。
 * nextBid 可带 exact（摘）或 fly（飞）布尔值；previousBid 支持对象或 [数量, 点数]。
 */
function validateBidTransition(previousBid, nextBid, onesWild = true) {
  const previous = readBid(previousBid);
  const next = readBid(nextBid);
  const exact = Boolean(nextBid && nextBid.exact);
  const fly = Boolean(nextBid && nextBid.fly);

  if (!next || !Number.isInteger(next.quantity) || next.quantity < 1) {
    return invalid('报价数量必须是正整数', onesWild);
  }
  if (!Number.isInteger(next.face) || next.face < 1 || next.face > 6) {
    return invalid('报价点数必须是 1 到 6 的整数', onesWild);
  }
  if (exact && fly) return invalid('同一次报价不能同时选择“摘”和“飞”', onesWild);
  if (fly && !previous) return invalid('首个报价不能选择“飞”', onesWild);
  if (fly && onesWild) return invalid('当前 1 已经是万能数，无需“飞”', onesWild);
  if (exact && !onesWild) return invalid('当前已经是“摘”状态', onesWild);
  if (fly && next.face === 1) return invalid('“飞”只能报价 2 到 6 点', onesWild);

  if (!previous) {
    const nextOnesWild = !(exact || next.face === 1);
    return {
      valid: true,
      reason: '',
      nextOnesWild,
      transition: nextOnesWild ? 'initial-wild' : 'initial-exact'
    };
  }
  if (!Number.isInteger(previous.quantity) || previous.quantity < 1) {
    return invalid('上一手报价数量无效', onesWild);
  }
  if (!Number.isInteger(previous.face) || previous.face < 1 || previous.face > 6) {
    return invalid('上一手报价点数无效', onesWild);
  }

  if (onesWild && (exact || next.face === 1)) {
    const minimum = Math.ceil(previous.quantity / 2);
    if (next.quantity < minimum) {
      return invalid(`“摘”后数量不能少于 ${minimum}`, onesWild);
    }
    return { valid: true, reason: '', nextOnesWild: false, transition: 'exact' };
  }

  if (!onesWild && fly) {
    const minimum = previous.quantity * 2;
    if (next.quantity < minimum) {
      return invalid(`“飞”后数量不能少于 ${minimum}`, onesWild);
    }
    return { valid: true, reason: '', nextOnesWild: true, transition: 'fly' };
  }

  const increases =
    next.quantity > previous.quantity ||
    (next.quantity === previous.quantity && next.face > previous.face);
  if (!increases) {
    return invalid('同一状态下，报价必须增加数量，或在数量相同时增加点数', onesWild);
  }

  return {
    valid: true,
    reason: '',
    nextOnesWild: onesWild,
    transition: onesWild ? 'wild' : 'exact'
  };
}

module.exports = {
  DICE_PER_HAND,
  REVOLVER_CHAMBERS,
  classifyDiceHand,
  getHandContribution,
  countBidDice,
  checkDiceBid,
  createDice,
  rerollDice,
  createRevolver,
  pullRevolver,
  revolverPublicState,
  validateBidTransition
};
