// Enthält RingBuffer Klassen

export class RingBuffer {
  constructor(size, ArrayType = Float32Array) {
    this.size = size;
    this.buffer = new ArrayType(size);
    this.index = 0;
    this.length = 0;
  }
  push(value) {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.length < this.size) this.length++;
  }
  toArray() {
    if (this.length < this.size) return Array.from(this.buffer.slice(0, this.length));
    const out = new this.buffer.constructor(this.length);
    out.set(this.buffer.subarray(this.index));
    out.set(this.buffer.subarray(0, this.index), this.size - this.index);
    return Array.from(out);
  }
}

export class MultiRingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.index = 0;
    this.size = 0;
  }
  push(sample) {
    this.buffer[this.index] = sample;
    this.index = (this.index + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }
  getLast(n) {
    const count = Math.min(n, this.size);
    return Array.from({ length: count }, (_, i) => {
      const idx = (this.index - count + i + this.capacity) % this.capacity;
      return this.buffer[idx];
    });
  }
  getFields(fieldName, n) { return this.getLast(n).map(s => s[fieldName]); }
}

export class MultiRingBuffer2 {
  constructor(channelTypes, size, channelNames) {
    this.channels = channelTypes.map(C => new C(size));
    this.index = 0;
    this.length = 0;
    this.size = size;
    this._cache = Array(channelTypes.length).fill(null);
    this.channelMap = channelNames.reduce((m, n, i) => { m[n] = i; return m; }, {});
    this.channelNames = channelNames;
  }
  push(values) {
    if (values.length !== this.channels.length) throw Error("wrong number of values");
    values.forEach((v, i)=>{ this.channels[i][this.index]=v; });
    this.index=(this.index+1)%this.size;
    if(this.length< this.size)this.length++;
  }
  getLast() {
    if (!this.length) return null;
    const idx=(this.index+this.size-1)%this.size;
    return this.channelNames.reduce((o,n,i)=>{o[n]=this.channels[i][idx];return o;}, {});
  }
  getFieldTypedArray(fieldName,count) {
    const ch=this.channelMap[fieldName];
    const buf=this.channels[ch];
    if(this.length<count) return buf.subarray(0,this.length);
    let start=(this.index+this.size-count)%this.size;
    const arr=new buf.constructor(count);
    if(start+count<=this.size) arr.set(buf.subarray(start,start+count));
    else {
      const first=this.size-start;
      arr.set(buf.subarray(start));
      arr.set(buf.subarray(0,count-first),first);
    }
    return arr;
  }
}
