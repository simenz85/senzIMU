class SafeDecoder {
  constructor() {
    this.ports = new Map();
  }

  processData(e) {
    try {
      const view = new DataView(e.data.buffer);
      const packets = [];
      
      for (let i = 0; i + 20 <= e.data.length; i += 20) {
        const offset = (e.data.start + i) % e.data.buffer.byteLength;
        
        packets.push({
          timestamp: view.getFloat32(offset, true),
          type: view.getUint8(offset + 4),
          accX: view.getFloat32(offset + 8, true),
          accY: view.getFloat32(offset + 12, true),
          accZ: view.getFloat32(offset + 16, true)
        });
      }

      this.ports.forEach(port => {
        port.postMessage({
          type: 'data',
          packets: packets
        });
      });

      e.ports[0].postMessage({ type: 'ack', processed: e.data.length });

    } catch (e) {
      self.postMessage({
        type: 'error',
        message: `Decoding failed: ${e.message}`
      });
      throw e;
    }
  }
}

const decoder = new SafeDecoder();

self.onmessage = (e) => {
  try {
    if (e.data.type === 'connect') {
      e.data.port.onmessage = (msg) => {
        if (msg.data.type === 'rawdata') {
          decoder.processData(msg);
        }
      };
      decoder.ports.set(e.data.source, e.data.port);
    }
  } catch (e) {
    self.postMessage({
      type: 'error',
      message: `Connection error: ${e.message}`
    });
  }
};