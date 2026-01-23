const crypto = require("crypto");
function nowMs(){ return Date.now(); }
function hmacHex(secret, payload){
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}
module.exports = { nowMs, hmacHex };
