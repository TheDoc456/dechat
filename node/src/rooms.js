const { nowMs } = require("./utils");

class Rooms {
  constructor({ idleTtlMs, maxUsersPerRoom, maxRooms }){
    this.idleTtlMs = idleTtlMs;
    this.maxUsersPerRoom = maxUsersPerRoom;
    this.maxRooms = maxRooms;
    this.rooms = new Map(); // roomId -> { users:Set(userId), lastActivityMs }
  }

  ensure(roomId){
    if(!this.rooms.has(roomId)){
      if(this.rooms.size >= this.maxRooms) return null;
      this.rooms.set(roomId, { users:new Set(), lastActivityMs: nowMs() });
    }
    return this.rooms.get(roomId);
  }

  join(roomId, userId){
    const r = this.ensure(roomId);
    if(!r) return { ok:false, error:"max_rooms" };
    if(r.users.size >= this.maxUsersPerRoom) return { ok:false, error:"room_full" };
    r.users.add(userId);
    r.lastActivityMs = nowMs();
    return { ok:true, userCount:r.users.size };
  }

  leave(roomId, userId){
    const r = this.rooms.get(roomId);
    if(!r) return;
    r.users.delete(userId);
    r.lastActivityMs = nowMs();
  }

  touch(roomId){
    const r = this.rooms.get(roomId);
    if(r) r.lastActivityMs = nowMs();
  }

  stats(){
    let roomsTotal = 0;
    let usersTotal = 0;
    for(const r of this.rooms.values()){
      roomsTotal++;
      usersTotal += r.users.size;
    }
    return { roomsTotal, usersTotal };
  }

  sweep(){
    const t = nowMs();
    for(const [roomId, r] of this.rooms.entries()){
      if(r.users.size === 0 && (t - r.lastActivityMs) > this.idleTtlMs){
        this.rooms.delete(roomId);
      }
    }
  }
}

module.exports = { Rooms };
