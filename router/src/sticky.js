const { nowMs } = require("./utils");

class StickyMap {
  constructor(ttlSec){
    this.ttlMs = Math.max(60, ttlSec|0) * 1000;
    this.map = new Map(); // roomId -> { nodeKey, expMs }
  }

  get(roomId){
    const v = this.map.get(roomId);
    if(!v) return null;
    if(v.expMs < nowMs()){ this.map.delete(roomId); return null; }
    return v.nodeKey;
  }

  set(roomId, nodeKey){
    this.map.set(roomId, { nodeKey, expMs: nowMs() + this.ttlMs });
  }

  sweep(){
    const t = nowMs();
    for(const [k,v] of this.map.entries()){
      if(v.expMs < t) this.map.delete(k);
    }
  }

  stats(){
    const t = nowMs();
    let n = 0;
    for(const v of this.map.values()) if(v.expMs >= t) n++;
    return { stickyMappedRooms: n };
  }
}

module.exports = { StickyMap };
