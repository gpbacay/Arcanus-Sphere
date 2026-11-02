/** A Map that keeps only its `max` most recently used entries. Used for the reply and voice caches. */
export class Lru<K, V> extends Map<K, V> {
  max: number;
  constructor(max: number) {
    super();
    this.max = max;
  }
  get(key: K) {
    const value = super.get(key);
    if (value !== undefined) {
      super.delete(key);
      super.set(key, value);
    }
    return value;
  }
  set(key: K, value: V) {
    super.delete(key);
    super.set(key, value);
    if (this.size > this.max) this.delete(this.keys().next().value as K);
    return this;
  }
}
