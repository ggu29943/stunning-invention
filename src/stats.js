import { store } from './util.js';

export const RECORDS_KEY = 'heelstomp.records.v1';
const KEY = RECORDS_KEY;

// Records shown as "+N 名称" popups while playing, like the original.
export const RECORDS = [
  { key: 'maxCombo', label: '最高连杀', live: true },
  { key: 'stompKills', label: '单脚最多击杀', live: true },
  { key: 'stompEgo', label: '单脚最多自尊', live: true },
  { key: 'fullKills', label: '满压击杀', live: true },
  { key: 'screams', label: '惨叫中断', live: true },
  { key: 'trash', label: '补刀清理', live: true },
  { key: 'heel', label: '鞋跟暴击', live: true },
  { key: 'crush', label: '碾压时长(秒)', live: true, float: true },
  { key: 'kills', label: '单局击杀', live: false },
  { key: 'ego', label: '单局自尊', live: false },
];

export function newSession() {
  return {
    kills: 0,
    ego: 0,
    maxCombo: 0,
    stompKills: 0,
    stompEgo: 0,
    fullKills: 0,
    screams: 0,
    trash: 0,
    heel: 0,
    crush: 0,
    stomps: 0,
  };
}

export class Records {
  constructor() {
    this.best = { ...newSession(), ...store.get(KEY, {}) };
    this.broken = new Set();
    this.popups = [];
    this.dirty = false;
  }

  beginSession() {
    this.broken.clear();
    this.popups.length = 0;
    this.snapshot = { ...this.best };
  }

  /** Compare the session against the best and emit "+delta" popups. */
  check(session) {
    for (const def of RECORDS) {
      const v = session[def.key];
      const prev = this.best[def.key] || 0;
      if (v > prev + (def.float ? 0.049 : 0)) {
        const delta = v - prev;
        this.best[def.key] = v;
        this.broken.add(def.key);
        this.dirty = true;
        if (def.live) this.popup(def, delta);
      }
    }
  }

  popup(def, delta) {
    const existing = this.popups.find((p) => p.key === def.key && p.age < 2.2);
    if (existing) {
      existing.delta += delta;
      existing.age = 0;
    } else {
      this.popups.push({ key: def.key, label: def.label, delta, age: 0, float: !!def.float });
      if (this.popups.length > 6) this.popups.shift();
    }
  }

  update(dt) {
    for (const p of this.popups) p.age += dt;
    this.popups = this.popups.filter((p) => p.age < 3);
    if (this.dirty) {
      this.saveTimer = (this.saveTimer || 0) + dt;
      if (this.saveTimer > 1) this.save();
    }
  }

  /** Take any higher values another tab has saved (in memory only). */
  merge() {
    const disk = store.get(KEY, {});
    for (const [k, v] of Object.entries(disk)) {
      if (typeof v === 'number' && !(this.best[k] >= v)) this.best[k] = v;
    }
  }

  save() {
    // another tab may have saved since we loaded: never write a lower value
    // over a higher one
    this.merge();
    this.dirty = false;
    this.saveTimer = 0;
    store.set(KEY, this.best);
  }
}
