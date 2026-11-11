// Uniform spatial hash (counting sort). Rebuilt every step, O(n).
export class Grid {
  constructor(world, cell, cap) {
    this.half = world / 2;
    this.cell = cell;
    this.n = Math.ceil(world / cell);
    this.start = new Int32Array(this.n * this.n + 1);
    this.items = new Int32Array(cap);
    this.cellOf = new Int32Array(cap);
  }

  cx(x) {
    let c = ((x + this.half) / this.cell) | 0;
    return c < 0 ? 0 : c >= this.n ? this.n - 1 : c;
  }

  // include(i) -> boolean
  build(hi, xs, zs, include) {
    const { start, items, cellOf, n } = this;
    start.fill(0);
    for (let i = 0; i < hi; i++) {
      if (!include(i)) {
        cellOf[i] = -1;
        continue;
      }
      const c = this.cx(zs[i]) * n + this.cx(xs[i]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < n * n; c++) start[c + 1] += start[c];
    const fill = this._fill || (this._fill = new Int32Array(n * n));
    fill.set(start.subarray(0, n * n));
    for (let i = 0; i < hi; i++) {
      const c = cellOf[i];
      if (c >= 0) items[fill[c]++] = i;
    }
  }
}
