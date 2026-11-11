// The constants of a world. They are rolled from the seed, so the same
// "law" can point the other way in a different world: you have to find out.
export function makeConstants(rng) {
  const slow = rng() < 0.5;
  return {
    attrSign: rng() < 0.5 ? 1 : -1, // same phase attracts (+1) or repels (-1)
    gravSign: rng() < 0.5 ? 1 : -1, // in phase with the sky = heavy (+1) or light (-1)
    syncSign: rng() < 0.7 ? 1 : -1, // neighbours synchronise (+1) or splay (-1)
    timeFactor: slow ? 0.22 + rng() * 0.18 : 2.4 + rng() * 1.4,
    skyPeriod: 70 + rng() * 60,
    G: 10 + rng() * 5,
    attrStrength: 26 + rng() * 18,
    syncK: 0.9 + rng() * 0.8,
  };
}

const same = '同じ色（位相）';
const opp = '正反対の色';

export const LAWS = [
  {
    id: 'gravity',
    name: '位相傾重',
    hint: '光の粒は、ある時は降り、ある時は昇る。空に浮かぶ環の色を見よ。高く昇れたなら、何かが分かる。',
    text: (C) =>
      (C.gravSign > 0
        ? `重さは位相で決まる。空の環と${same}のものほど重く沈み、${opp}のものは浮かび上がる。`
        : `重さは位相で決まる。空の環と${opp}のものほど重く沈み、${same}のものは浮かび上がる。`) +
      `空の環は約${Math.round(C.skyPeriod)}秒で色を一巡させる。自分の位相（Q/E）を合わせれば、飛べる。`,
    instrument: '位相計に「空の環」の針が表示されるようになった。',
  },
  {
    id: 'force',
    name: '位相間力',
    hint: '柱に近づくと、体が何かに引かれる——あるいは押し返される。',
    text: (C) =>
      C.attrSign > 0
        ? `${same}どうしは引き合い、${opp}どうしは反発する。柱は動かないが、あなたは動く。`
        : `${same}どうしは反発し、${opp}どうしが引き合う。柱は動かないが、あなたは動く。`,
  },
  {
    id: 'sync',
    name: '位相の伝染',
    hint: '群れの中にしばらく留まると、自分の色が勝手に変わっていく。',
    text: (C) =>
      C.syncSign > 0
        ? '近くにいるもの同士の位相は揃っていく。群れはやがて一色に染まり、あなたも染まる。'
        : '近くにいるもの同士の位相は互いに離れようとする。群れは虹のようにばらけ、あなたは押し出される。',
  },
  {
    id: 'time',
    name: '時間の粘度',
    hint: '結晶のそばでは、粒や生き物の動きが妙だ。',
    text: (C) =>
      C.timeFactor < 1
        ? `結晶の周りでは時間が遅く流れる（約×${C.timeFactor.toFixed(2)}）。そこに住む者は長く生き、ゆっくり進化する。`
        : `結晶の周りでは時間が速く流れる（約×${C.timeFactor.toFixed(1)}）。そこでは世代交代が加速する。`,
    instrument: '位相計に局所時間の倍率が表示されるようになった。',
  },
  {
    id: 'graze',
    name: '光食',
    hint: '丸い漂生体は何かを探して地を這っている。観測してみよ。',
    text: () => '漂生体は地に降りた光の粒を食べて生きる。粒が重くなる時、食卓が開く。',
  },
  {
    id: 'predation',
    name: '捕食',
    hint: '尖った姿の者がいる。観測してみよ。',
    text: () => '一部の漂生体は、自分より小さな漂生体を喰らう。喰われる側は逃げることを覚える。',
  },
  {
    id: 'heredity',
    name: '継承と変異',
    hint: '多くの世代を重ねた個体を観測せよ（世代4以上）。',
    text: () =>
      '十分なエネルギーを得た漂生体は分裂する。子は親の形質を受け継ぎ、わずかに変わる。生き残った変化だけが次へ渡る。',
  },
  {
    id: 'cycle',
    name: '還元',
    hint: '死の瞬間をすぐそばで見届けよ。',
    text: () => '死んだ漂生体は光の粒に還る。命は粒から生まれ、粒へと戻る。',
  },
  {
    id: 'memory',
    name: '地形の記憶',
    hint: '光る筋が地面を走っている場所がある。その上に立て。',
    text: () => '多く通られた地面は沈み、淡く光る。地形は通ったものを記憶し、ゆっくり忘れる。',
  },
  {
    id: 'crystal',
    name: '結晶化',
    hint: '結晶はどこから来るのか。大きな群れのそばで待て。',
    text: (C) =>
      C.syncSign > 0
        ? '色の揃った大きな群れは、その場に結晶を生む。結晶はこの世界の地図を書き換える。'
        : '色が完全にばらけた大きな群れは、その場に結晶を生む。結晶はこの世界の地図を書き換える。',
  },
  {
    id: 'pulse',
    name: '共鳴放射',
    hint: '自分の位相を周囲に放て（Rキー）。光の粒の群れの中で。',
    text: (C) =>
      C.attrSign > 0
        ? `自分の位相を放つと、${same}のものは引き寄せられ、${opp}のものは吹き飛ぶ。`
        : `自分の位相を放つと、${same}のものは吹き飛び、${opp}のものが引き寄せられる。`,
  },
];

export const LAW_BY_ID = Object.fromEntries(LAWS.map((l) => [l.id, l]));
