const os = require("os");
const { nowMs } = require("./utils");

function nodeStats({ nodeKey, publicUrl, rooms }){
  const up = process.uptime();
  const la = os.loadavg();
  const mem = process.memoryUsage();
  const rs = rooms.stats();
  return {
    ok:true,
    at: nowMs(),
    node: { key: nodeKey, publicUrl },
    runtime: {
      uptimeSec: Math.floor(up),
      loadavg: la,
      rssMb: Math.round(mem.rss/1024/1024),
      heapUsedMb: Math.round(mem.heapUsed/1024/1024)
    },
    activity: rs
  };
}

module.exports = { nodeStats };
