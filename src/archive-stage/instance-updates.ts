/**
 * Instanced buffer range updates, adapted from RhineLabUI `src/instance-updates.ts`
 * (MIT, Copyright (c) 2026 LBEILC). See LICENSE-RHINE-REFERENCE.txt.
 */
import { InstancedBufferAttribute } from "three";

export class InstanceUpdates {
  private first = Infinity;
  private last = -1;
  readonly attribute: InstancedBufferAttribute;
  constructor(attribute: InstancedBufferAttribute) {
    this.attribute = attribute;
  }
  set(offset: number, values: ArrayLike<number>) {
    const array = this.attribute.array;
    for (let j = 0; j < values.length; j++) {
      const i = offset + j;
      const value = Math.fround(values[j]);
      if (array[i] === value) continue;
      array[i] = value;
      this.first = Math.min(this.first, i);
      this.last = Math.max(this.last, i);
    }
  }
  commit() {
    if (this.last < 0) return false;
    this.attribute.addUpdateRange(this.first, this.last - this.first + 1);
    this.attribute.needsUpdate = true;
    this.first = Infinity;
    this.last = -1;
    return true;
  }
}
