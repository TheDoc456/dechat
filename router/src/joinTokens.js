const { nowMs, randHex } = require("./utils");

class JoinTokens {
  constructor(){
    // token -> { expMs }
    this.tokens = new Map();
  }

  mint(ttlSec){
    const t = randHex(24); // 48 chars
    const expMs = nowMs() + Math.max(60, ttlSec|0) * 1000;
    this.tokens.set(t, { expMs });
    return { token: t, expMs };
  }

  consume(token){
    const v = this.tokens.get(token);
    if(!v) return null;
    if(v.expMs < nowMs()){ this.tokens.delete(token); return null; }
    this.tokens.delete(token);
    return v;
  }

  sweep(){
    const t = nowMs();
    for(const [k,v] of this.tokens.entries()){
      if(v.expMs < t) this.tokens.delete(k);
    }
  }
}

module.exports = { JoinTokens };
