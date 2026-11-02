/**
 * Active/standby leader election using a lease document in the shared database.
 *
 * Every node (your PC + your backup server) logs in to Discord and stays "warm",
 * but only the node holding the lease actually handles events. If the leader
 * stops renewing (PC powered off), the standby takes the lease within ~TTL seconds.
 * When the primary returns, it asks the standby to hand control back.
 */
const { EventEmitter } = require('events');
const config = require('../config');
const db = require('./database');
const log = require('../utils/logger')('leader');

const KEY = 'leader';
const { ttl, interval, margin } = config.lease;

class Leader extends EventEmitter {
  constructor() {
    super();
    this.id = `${config.node.name}:${process.pid}`;
    this.leader = false;
    this.validUntil = 0;
    this.busy = false;
    this.timer = null;
    this.holdOff = 0; // after handing control back, don't immediately re-grab it
    this.canLead = () => true;
  }

  /** True only while we hold a lease we have recently, successfully renewed. */
  isLeader() {
    return this.leader && Date.now() < this.validUntil;
  }

  start(canLead) {
    this.canLead = canLead;
    this.timer = setInterval(() => this.tick(), interval);
    this.tick();
  }

  async stop() {
    clearInterval(this.timer);
    if (this.leader) {
      try {
        await db.meta().updateOne(
          { _id: KEY, holder: this.id },
          { $set: { holder: null, expiresAt: 0, handoff: false } },
        );
      } catch { /* lease will simply expire */ }
    }
    this._set(false);
  }

  _set(value) {
    if (this.leader === value) return;
    this.leader = value;
    if (!value) this.validUntil = 0;
    log.info(value ? `👑 ${this.id} is now the ACTIVE node` : `${this.id} is now STANDBY`);
    this.emit(value ? 'elected' : 'demoted');
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this._tick();
    } catch (err) {
      log.warn(`lease check failed: ${err.message}`);
    } finally {
      // Self-fence: if we could not renew in time, stop acting as leader.
      if (this.leader && Date.now() >= this.validUntil) this._set(false);
      this.busy = false;
    }
  }

  async _tick() {
    const col = db.meta();
    const t0 = Date.now();
    const me = this.id;

    if (this.leader) {
      const doc = await col.findOne({ _id: KEY });
      if (doc?.holder === me && doc.handoff) {
        // The primary is back and healthy - release gracefully.
        await col.updateOne({ _id: KEY, holder: me }, { $set: { holder: null, expiresAt: 0, handoff: false } });
        this.holdOff = Date.now() + interval * 3;
        this._set(false);
        return;
      }
      const res = await col.updateOne({ _id: KEY, holder: me }, { $set: { expiresAt: t0 + ttl, renewedAt: new Date() } });
      if (res.matchedCount) this.validUntil = t0 + ttl - margin;
      else this._set(false); // someone else took it
      return;
    }

    if (!this.canLead() || Date.now() < this.holdOff) return; // only take over once Discord is connected

    try {
      const res = await col.updateOne(
        { _id: KEY, $or: [{ holder: null }, { expiresAt: { $lt: t0 } }] },
        {
          $set: {
            holder: me, name: config.node.name, role: config.node.role,
            expiresAt: t0 + ttl, handoff: false, since: new Date(),
          },
        },
        { upsert: true },
      );
      if (res.matchedCount || res.upsertedCount) {
        this.validUntil = t0 + ttl - margin;
        this._set(true);
        return;
      }
    } catch (err) {
      if (err.code !== 11000) throw err; // 11000 = lease exists and is held by someone else
    }

    // Lease is held by a live node. If we are the primary and it is a backup, ask for it back.
    if (config.node.role === 'primary') {
      await col.updateOne(
        { _id: KEY, role: { $ne: 'primary' }, holder: { $ne: null }, expiresAt: { $gte: t0 } },
        { $set: { handoff: true } },
      );
    }
  }
}

module.exports = new Leader();
