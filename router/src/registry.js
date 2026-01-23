const { nowMs } = require("./utils");

class NodeRegistry {
  constructor(){
    // key -> { key, publicUrl, nodeSecret, lastSeenMs }
    this.nodes = new Map();
  }

  upsert({ key, publicUrl, nodeSecret }){
    const prev = this.nodes.get(key);
    this.nodes.set(key, {
      key,
      publicUrl,
      nodeSecret: nodeSecret || (prev && prev.nodeSecret) || null,
      lastSeenMs: nowMs()
    });
  }

  touch(key){
    const n = this.nodes.get(key);
    if(n) n.lastSeenMs = nowMs();
  }

  get(key){ return this.nodes.get(key) || null; }

  listPublic(){
    const cutoff = nowMs() - 90_000;
    return Array.from(this.nodes.values())
      .filter(n => n.lastSeenMs >= cutoff)
      .map(n => ({ key: n.key, baseUrl: n.publicUrl }));
  }

  listInternal(){
    const cutoff = nowMs() - 90_000;
    return Array.from(this.nodes.values()).filter(n => n.lastSeenMs >= cutoff);
  }
}

module.exports = { NodeRegistry };
