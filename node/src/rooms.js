class Rooms {
  constructor(opts = {}) {
    this.idleTtlMs = Number(opts.idleTtlMs || 600_000);
    this.maxUsersPerRoom = Number(opts.maxUsersPerRoom || 10);
    this.maxRooms = Number(opts.maxRooms || 500);
    this.rooms = new Map();
  }

  roomCount() {
    return this.rooms.size;
  }

  userCount() {
    let total = 0;
    for (const r of this.rooms.values()) total += r.users.size;
    return total;
  }

  stats() {
    return { rooms: this.roomCount(), users: this.userCount() };
  }

  touch(roomId) {
    const r = this.rooms.get(roomId);
    if (r) r.lastActiveMs = Date.now();
  }

  join(roomId, userId) {
    if (!roomId || !userId) return { ok: false, error: "bad_request" };

    let r = this.rooms.get(roomId);
    if (!r) {
      if (this.rooms.size >= this.maxRooms) return { ok: false, error: "rooms_full" };
      r = { users: new Set(), lastActiveMs: Date.now() };
      this.rooms.set(roomId, r);
    }

    if (!r.users.has(userId) && r.users.size >= this.maxUsersPerRoom) {
      return { ok: false, error: "room_full" };
    }

    r.users.add(userId);
    r.lastActiveMs = Date.now();
    return { ok: true, userCount: r.users.size };
  }

  leave(roomId, userId) {
    const r = this.rooms.get(roomId);
    if (!r) return;

    r.users.delete(userId);
    r.lastActiveMs = Date.now();
    if (r.users.size === 0) this.rooms.delete(roomId);
  }

  sweep() {
    const now = Date.now();
    for (const [roomId, r] of this.rooms.entries()) {
      if (now - (r.lastActiveMs || 0) > this.idleTtlMs) this.rooms.delete(roomId);
    }
  }
}

module.exports = { Rooms };
