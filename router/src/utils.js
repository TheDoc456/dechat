const crypto = require("crypto");
function nowMs(){ return Date.now(); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function randHex(bytes){ return crypto.randomBytes(bytes).toString("hex"); }
function randId(prefix, len){
  const s = crypto.randomBytes(Math.ceil(len/2)).toString("hex").toUpperCase().slice(0,len);
  return `${prefix}${s}`;
}
function hmacHex(secret, payload){
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
module.exports = { nowMs, clamp, randHex, randId, hmacHex };
