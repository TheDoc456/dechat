"use strict";

const fs = require("fs");
const path = require("path");

class NodeRegistry {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || "/data";
    this.filePath = opts.filePath || path.join(this.dataDir, "registry.json");

    // key -> node record
    this.nodes = new Map();

    this._saveTimer = null;
    this._saveDelayMs = 250;

    this._loadFromDisk();
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        console.log("[registry] no registry file yet (first boot)");
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      const json = JSON.parse(raw);

      if (json && Array.isArray(json.nodes)) {
        for (const n of json.nodes) {
          if (!n || !n.key) continue;
          this.nodes.set(String(n.key), {
            key: String(n.key),
            publicUrl: String(n.publicUrl || ""),
            nodeSecret: String(n.nodeSecret || ""),
            roomsActive: Number(n.roomsActive || 0),
            usersActive: Number(n.usersActive || 0),
            createdAt: Number(n.createdAt || Date.now()),
            lastSeenAt: Number(n.lastSeenAt || 0),
          });
        }
      }
      console.log(`[registry] loaded ${this.nodes.size} nodes`);
    } catch (e) {
      console.error("[registry] failed to load registry:", e);
    }
  }

  _scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveToDisk();
    }, this._saveDelayMs).unref?.() || undefined;
  }

  _saveToDisk() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload = {
        version: 1,
        savedAt: Date.now(),
        nodes: Array.from(this.nodes.values()),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (e) {
      console.error("[registry] failed to save registry:", e);
    }
  }

  resetOnlineState() {
    // We keep nodes but mark them unseen until they re-register.
    for (const n of this.nodes.values()) {
      n.lastSeenAt = 0;
    }
    this._scheduleSave();
  }

  get(key) {
    return this.nodes.get(String(key)) || null;
  }

  add(node) {
    const key = String(node.key);
    if (!key) return false;

    const existing = this.nodes.get(key);
    if (existing) return false;

    const rec = {
      key,
      publicUrl: String(node.publicUrl || ""),
      nodeSecret: String(node.nodeSecret || ""),
      roomsActive: Number(node.roomsActive || 0),
      usersActive: Number(node.usersActive || 0),
      createdAt: Date.now(),
      lastSeenAt: Number(node.lastSeenAt || 0),
    };

    this.nodes.set(key, rec);
    this._scheduleSave();
    return true;
  }

  upsert(node) {
    const key = String(node.key);
    if (!key) return false;

    const prev = this.nodes.get(key);

    const rec = {
      key,
      publicUrl: String(node.publicUrl ?? (prev ? prev.publicUrl : "")),
      nodeSecret: String(node.nodeSecret ?? (prev ? prev.nodeSecret : "")),
      roomsActive: Number(node.roomsActive ?? (prev ? prev.roomsActive : 0)),
      usersActive: Number(node.usersActive ?? (prev ? prev.usersActive : 0)),
      createdAt: prev ? prev.createdAt : Date.now(),
      lastSeenAt: Number(node.lastSeenAt ?? (prev ? prev.lastSeenAt : 0)),
    };

    this.nodes.set(key, rec);
    this._scheduleSave();
    return true;
  }

  markSeen(key, patch = {}) {
    const n = this.get(key);
    if (!n) return false;

    if (patch.publicUrl != null) n.publicUrl = String(patch.publicUrl);
    if (patch.roomsActive != null) n.roomsActive = Number(patch.roomsActive) || 0;
    if (patch.usersActive != null) n.usersActive = Number(patch.usersActive) || 0;

    n.lastSeenAt = Date.now();
    this._scheduleSave();
    return true;
  }

  isOnline(node, ttlMs) {
    if (!node || !node.lastSeenAt) return false;
    return (Date.now() - node.lastSeenAt) <= Number(ttlMs || 30_000);
  }

  countOnline(ttlMs = 30_000) {
    let c = 0;
    for (const n of this.nodes.values()) {
      if (this.isOnline(n, ttlMs)) c++;
    }
    return c;
  }

  listInternal(ttlMs = 30_000) {
    // Only online nodes should be candidates for allocation
    const out = [];
    for (const n of this.nodes.values()) {
      if (this.isOnline(n, ttlMs)) out.push({ ...n });
    }
    return out;
  }

  listPublic(ttlMs = 30_000) {
    // Public list can include online flag (handy for dashboard)
    const out = [];
    for (const n of this.nodes.values()) {
      const online = this.isOnline(n, ttlMs);
      out.push({
        key: n.key,
        publicUrl: n.publicUrl,
        roomsActive: Number(n.roomsActive || 0),
        usersActive: Number(n.usersActive || 0),
        lastSeenAt: Number(n.lastSeenAt || 0),
        online,
      });
    }
    return out;
  }
}

module.exports = NodeRegistry;
