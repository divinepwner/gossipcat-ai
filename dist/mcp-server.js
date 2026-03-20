#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs
var require_utf8 = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.utf8Count = utf8Count;
    exports2.utf8EncodeJs = utf8EncodeJs;
    exports2.utf8EncodeTE = utf8EncodeTE;
    exports2.utf8Encode = utf8Encode;
    exports2.utf8DecodeJs = utf8DecodeJs;
    exports2.utf8DecodeTD = utf8DecodeTD;
    exports2.utf8Decode = utf8Decode;
    function utf8Count(str) {
      const strLength = str.length;
      let byteLength = 0;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          byteLength++;
          continue;
        } else if ((value & 4294965248) === 0) {
          byteLength += 2;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            byteLength += 3;
          } else {
            byteLength += 4;
          }
        }
      }
      return byteLength;
    }
    function utf8EncodeJs(str, output, outputOffset) {
      const strLength = str.length;
      let offset = outputOffset;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          output[offset++] = value;
          continue;
        } else if ((value & 4294965248) === 0) {
          output[offset++] = value >> 6 & 31 | 192;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            output[offset++] = value >> 12 & 15 | 224;
            output[offset++] = value >> 6 & 63 | 128;
          } else {
            output[offset++] = value >> 18 & 7 | 240;
            output[offset++] = value >> 12 & 63 | 128;
            output[offset++] = value >> 6 & 63 | 128;
          }
        }
        output[offset++] = value & 63 | 128;
      }
    }
    var sharedTextEncoder = new TextEncoder();
    var TEXT_ENCODER_THRESHOLD = 50;
    function utf8EncodeTE(str, output, outputOffset) {
      sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
    }
    function utf8Encode(str, output, outputOffset) {
      if (str.length > TEXT_ENCODER_THRESHOLD) {
        utf8EncodeTE(str, output, outputOffset);
      } else {
        utf8EncodeJs(str, output, outputOffset);
      }
    }
    var CHUNK_SIZE = 4096;
    function utf8DecodeJs(bytes, inputOffset, byteLength) {
      let offset = inputOffset;
      const end = offset + byteLength;
      const units = [];
      let result = "";
      while (offset < end) {
        const byte1 = bytes[offset++];
        if ((byte1 & 128) === 0) {
          units.push(byte1);
        } else if ((byte1 & 224) === 192) {
          const byte2 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 6 | byte2);
        } else if ((byte1 & 240) === 224) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
        } else if ((byte1 & 248) === 240) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          const byte4 = bytes[offset++] & 63;
          let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
          if (unit > 65535) {
            unit -= 65536;
            units.push(unit >>> 10 & 1023 | 55296);
            unit = 56320 | unit & 1023;
          }
          units.push(unit);
        } else {
          units.push(byte1);
        }
        if (units.length >= CHUNK_SIZE) {
          result += String.fromCharCode(...units);
          units.length = 0;
        }
      }
      if (units.length > 0) {
        result += String.fromCharCode(...units);
      }
      return result;
    }
    var sharedTextDecoder = new TextDecoder();
    var TEXT_DECODER_THRESHOLD = 200;
    function utf8DecodeTD(bytes, inputOffset, byteLength) {
      const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
      return sharedTextDecoder.decode(stringBytes);
    }
    function utf8Decode(bytes, inputOffset, byteLength) {
      if (byteLength > TEXT_DECODER_THRESHOLD) {
        return utf8DecodeTD(bytes, inputOffset, byteLength);
      } else {
        return utf8DecodeJs(bytes, inputOffset, byteLength);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs
var require_ExtData = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ExtData = void 0;
    var ExtData = class {
      type;
      data;
      constructor(type, data) {
        this.type = type;
        this.data = data;
      }
    };
    exports2.ExtData = ExtData;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs
var require_DecodeError = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DecodeError = void 0;
    var DecodeError = class _DecodeError extends Error {
      constructor(message) {
        super(message);
        const proto = Object.create(_DecodeError.prototype);
        Object.setPrototypeOf(this, proto);
        Object.defineProperty(this, "name", {
          configurable: true,
          enumerable: false,
          value: _DecodeError.name
        });
      }
    };
    exports2.DecodeError = DecodeError;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs
var require_int = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.UINT32_MAX = void 0;
    exports2.setUint64 = setUint64;
    exports2.setInt64 = setInt64;
    exports2.getInt64 = getInt64;
    exports2.getUint64 = getUint64;
    exports2.UINT32_MAX = 4294967295;
    function setUint64(view, offset, value) {
      const high = value / 4294967296;
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function setInt64(view, offset, value) {
      const high = Math.floor(value / 4294967296);
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function getInt64(view, offset) {
      const high = view.getInt32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
    function getUint64(view, offset) {
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs
var require_timestamp = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.timestampExtension = exports2.EXT_TIMESTAMP = void 0;
    exports2.encodeTimeSpecToTimestamp = encodeTimeSpecToTimestamp;
    exports2.encodeDateToTimeSpec = encodeDateToTimeSpec;
    exports2.encodeTimestampExtension = encodeTimestampExtension;
    exports2.decodeTimestampToTimeSpec = decodeTimestampToTimeSpec;
    exports2.decodeTimestampExtension = decodeTimestampExtension;
    var DecodeError_ts_1 = require_DecodeError();
    var int_ts_1 = require_int();
    exports2.EXT_TIMESTAMP = -1;
    var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
    var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
    function encodeTimeSpecToTimestamp({ sec, nsec }) {
      if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
        if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
          const rv = new Uint8Array(4);
          const view = new DataView(rv.buffer);
          view.setUint32(0, sec);
          return rv;
        } else {
          const secHigh = sec / 4294967296;
          const secLow = sec & 4294967295;
          const rv = new Uint8Array(8);
          const view = new DataView(rv.buffer);
          view.setUint32(0, nsec << 2 | secHigh & 3);
          view.setUint32(4, secLow);
          return rv;
        }
      } else {
        const rv = new Uint8Array(12);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec);
        (0, int_ts_1.setInt64)(view, 4, sec);
        return rv;
      }
    }
    function encodeDateToTimeSpec(date) {
      const msec = date.getTime();
      const sec = Math.floor(msec / 1e3);
      const nsec = (msec - sec * 1e3) * 1e6;
      const nsecInSec = Math.floor(nsec / 1e9);
      return {
        sec: sec + nsecInSec,
        nsec: nsec - nsecInSec * 1e9
      };
    }
    function encodeTimestampExtension(object) {
      if (object instanceof Date) {
        const timeSpec = encodeDateToTimeSpec(object);
        return encodeTimeSpecToTimestamp(timeSpec);
      } else {
        return null;
      }
    }
    function decodeTimestampToTimeSpec(data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      switch (data.byteLength) {
        case 4: {
          const sec = view.getUint32(0);
          const nsec = 0;
          return { sec, nsec };
        }
        case 8: {
          const nsec30AndSecHigh2 = view.getUint32(0);
          const secLow32 = view.getUint32(4);
          const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
          const nsec = nsec30AndSecHigh2 >>> 2;
          return { sec, nsec };
        }
        case 12: {
          const sec = (0, int_ts_1.getInt64)(view, 4);
          const nsec = view.getUint32(0);
          return { sec, nsec };
        }
        default:
          throw new DecodeError_ts_1.DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
      }
    }
    function decodeTimestampExtension(data) {
      const timeSpec = decodeTimestampToTimeSpec(data);
      return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
    }
    exports2.timestampExtension = {
      type: exports2.EXT_TIMESTAMP,
      encode: encodeTimestampExtension,
      decode: decodeTimestampExtension
    };
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs
var require_ExtensionCodec = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ExtensionCodec = void 0;
    var ExtData_ts_1 = require_ExtData();
    var timestamp_ts_1 = require_timestamp();
    var ExtensionCodec = class _ExtensionCodec {
      static defaultCodec = new _ExtensionCodec();
      // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
      // this will make type errors a lot more clear
      // eslint-disable-next-line @typescript-eslint/naming-convention
      __brand;
      // built-in extensions
      builtInEncoders = [];
      builtInDecoders = [];
      // custom extensions
      encoders = [];
      decoders = [];
      constructor() {
        this.register(timestamp_ts_1.timestampExtension);
      }
      register({ type, encode, decode }) {
        if (type >= 0) {
          this.encoders[type] = encode;
          this.decoders[type] = decode;
        } else {
          const index = -1 - type;
          this.builtInEncoders[index] = encode;
          this.builtInDecoders[index] = decode;
        }
      }
      tryToEncode(object, context) {
        for (let i = 0; i < this.builtInEncoders.length; i++) {
          const encodeExt = this.builtInEncoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = -1 - i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        for (let i = 0; i < this.encoders.length; i++) {
          const encodeExt = this.encoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        if (object instanceof ExtData_ts_1.ExtData) {
          return object;
        }
        return null;
      }
      decode(data, type, context) {
        const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
        if (decodeExt) {
          return decodeExt(data, type, context);
        } else {
          return new ExtData_ts_1.ExtData(type, data);
        }
      }
    };
    exports2.ExtensionCodec = ExtensionCodec;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs
var require_typedArrays = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ensureUint8Array = ensureUint8Array;
    function isArrayBufferLike(buffer) {
      return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
    }
    function ensureUint8Array(buffer) {
      if (buffer instanceof Uint8Array) {
        return buffer;
      } else if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else if (isArrayBufferLike(buffer)) {
        return new Uint8Array(buffer);
      } else {
        return Uint8Array.from(buffer);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs
var require_Encoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Encoder = exports2.DEFAULT_INITIAL_BUFFER_SIZE = exports2.DEFAULT_MAX_DEPTH = void 0;
    var utf8_ts_1 = require_utf8();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var typedArrays_ts_1 = require_typedArrays();
    exports2.DEFAULT_MAX_DEPTH = 100;
    exports2.DEFAULT_INITIAL_BUFFER_SIZE = 2048;
    var Encoder = class _Encoder {
      extensionCodec;
      context;
      useBigInt64;
      maxDepth;
      initialBufferSize;
      sortKeys;
      forceFloat32;
      ignoreUndefined;
      forceIntegerToFloat;
      pos;
      view;
      bytes;
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.maxDepth = options?.maxDepth ?? exports2.DEFAULT_MAX_DEPTH;
        this.initialBufferSize = options?.initialBufferSize ?? exports2.DEFAULT_INITIAL_BUFFER_SIZE;
        this.sortKeys = options?.sortKeys ?? false;
        this.forceFloat32 = options?.forceFloat32 ?? false;
        this.ignoreUndefined = options?.ignoreUndefined ?? false;
        this.forceIntegerToFloat = options?.forceIntegerToFloat ?? false;
        this.pos = 0;
        this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
        this.bytes = new Uint8Array(this.view.buffer);
      }
      clone() {
        return new _Encoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          maxDepth: this.maxDepth,
          initialBufferSize: this.initialBufferSize,
          sortKeys: this.sortKeys,
          forceFloat32: this.forceFloat32,
          ignoreUndefined: this.ignoreUndefined,
          forceIntegerToFloat: this.forceIntegerToFloat
        });
      }
      reinitializeState() {
        this.pos = 0;
      }
      /**
       * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
       *
       * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
       */
      encodeSharedRef(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encodeSharedRef(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.subarray(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      /**
       * @returns Encodes the object and returns a copy of the encoder's internal buffer.
       */
      encode(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encode(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.slice(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      doEncode(object, depth) {
        if (depth > this.maxDepth) {
          throw new Error(`Too deep objects in depth ${depth}`);
        }
        if (object == null) {
          this.encodeNil();
        } else if (typeof object === "boolean") {
          this.encodeBoolean(object);
        } else if (typeof object === "number") {
          if (!this.forceIntegerToFloat) {
            this.encodeNumber(object);
          } else {
            this.encodeNumberAsFloat(object);
          }
        } else if (typeof object === "string") {
          this.encodeString(object);
        } else if (this.useBigInt64 && typeof object === "bigint") {
          this.encodeBigInt64(object);
        } else {
          this.encodeObject(object, depth);
        }
      }
      ensureBufferSizeToWrite(sizeToWrite) {
        const requiredSize = this.pos + sizeToWrite;
        if (this.view.byteLength < requiredSize) {
          this.resizeBuffer(requiredSize * 2);
        }
      }
      resizeBuffer(newSize) {
        const newBuffer = new ArrayBuffer(newSize);
        const newBytes = new Uint8Array(newBuffer);
        const newView = new DataView(newBuffer);
        newBytes.set(this.bytes);
        this.view = newView;
        this.bytes = newBytes;
      }
      encodeNil() {
        this.writeU8(192);
      }
      encodeBoolean(object) {
        if (object === false) {
          this.writeU8(194);
        } else {
          this.writeU8(195);
        }
      }
      encodeNumber(object) {
        if (!this.forceIntegerToFloat && Number.isSafeInteger(object)) {
          if (object >= 0) {
            if (object < 128) {
              this.writeU8(object);
            } else if (object < 256) {
              this.writeU8(204);
              this.writeU8(object);
            } else if (object < 65536) {
              this.writeU8(205);
              this.writeU16(object);
            } else if (object < 4294967296) {
              this.writeU8(206);
              this.writeU32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(207);
              this.writeU64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          } else {
            if (object >= -32) {
              this.writeU8(224 | object + 32);
            } else if (object >= -128) {
              this.writeU8(208);
              this.writeI8(object);
            } else if (object >= -32768) {
              this.writeU8(209);
              this.writeI16(object);
            } else if (object >= -2147483648) {
              this.writeU8(210);
              this.writeI32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(211);
              this.writeI64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          }
        } else {
          this.encodeNumberAsFloat(object);
        }
      }
      encodeNumberAsFloat(object) {
        if (this.forceFloat32) {
          this.writeU8(202);
          this.writeF32(object);
        } else {
          this.writeU8(203);
          this.writeF64(object);
        }
      }
      encodeBigInt64(object) {
        if (object >= BigInt(0)) {
          this.writeU8(207);
          this.writeBigUint64(object);
        } else {
          this.writeU8(211);
          this.writeBigInt64(object);
        }
      }
      writeStringHeader(byteLength) {
        if (byteLength < 32) {
          this.writeU8(160 + byteLength);
        } else if (byteLength < 256) {
          this.writeU8(217);
          this.writeU8(byteLength);
        } else if (byteLength < 65536) {
          this.writeU8(218);
          this.writeU16(byteLength);
        } else if (byteLength < 4294967296) {
          this.writeU8(219);
          this.writeU32(byteLength);
        } else {
          throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
        }
      }
      encodeString(object) {
        const maxHeaderSize = 1 + 4;
        const byteLength = (0, utf8_ts_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_ts_1.utf8Encode)(object, this.bytes, this.pos);
        this.pos += byteLength;
      }
      encodeObject(object, depth) {
        const ext = this.extensionCodec.tryToEncode(object, this.context);
        if (ext != null) {
          this.encodeExtension(ext);
        } else if (Array.isArray(object)) {
          this.encodeArray(object, depth);
        } else if (ArrayBuffer.isView(object)) {
          this.encodeBinary(object);
        } else if (typeof object === "object") {
          this.encodeMap(object, depth);
        } else {
          throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
        }
      }
      encodeBinary(object) {
        const size = object.byteLength;
        if (size < 256) {
          this.writeU8(196);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(197);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(198);
          this.writeU32(size);
        } else {
          throw new Error(`Too large binary: ${size}`);
        }
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(object);
        this.writeU8a(bytes);
      }
      encodeArray(object, depth) {
        const size = object.length;
        if (size < 16) {
          this.writeU8(144 + size);
        } else if (size < 65536) {
          this.writeU8(220);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(221);
          this.writeU32(size);
        } else {
          throw new Error(`Too large array: ${size}`);
        }
        for (const item of object) {
          this.doEncode(item, depth + 1);
        }
      }
      countWithoutUndefined(object, keys) {
        let count = 0;
        for (const key of keys) {
          if (object[key] !== void 0) {
            count++;
          }
        }
        return count;
      }
      encodeMap(object, depth) {
        const keys = Object.keys(object);
        if (this.sortKeys) {
          keys.sort();
        }
        const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
        if (size < 16) {
          this.writeU8(128 + size);
        } else if (size < 65536) {
          this.writeU8(222);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(223);
          this.writeU32(size);
        } else {
          throw new Error(`Too large map object: ${size}`);
        }
        for (const key of keys) {
          const value = object[key];
          if (!(this.ignoreUndefined && value === void 0)) {
            this.encodeString(key);
            this.doEncode(value, depth + 1);
          }
        }
      }
      encodeExtension(ext) {
        if (typeof ext.data === "function") {
          const data = ext.data(this.pos + 6);
          const size2 = data.length;
          if (size2 >= 4294967296) {
            throw new Error(`Too large extension object: ${size2}`);
          }
          this.writeU8(201);
          this.writeU32(size2);
          this.writeI8(ext.type);
          this.writeU8a(data);
          return;
        }
        const size = ext.data.length;
        if (size === 1) {
          this.writeU8(212);
        } else if (size === 2) {
          this.writeU8(213);
        } else if (size === 4) {
          this.writeU8(214);
        } else if (size === 8) {
          this.writeU8(215);
        } else if (size === 16) {
          this.writeU8(216);
        } else if (size < 256) {
          this.writeU8(199);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(200);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(201);
          this.writeU32(size);
        } else {
          throw new Error(`Too large extension object: ${size}`);
        }
        this.writeI8(ext.type);
        this.writeU8a(ext.data);
      }
      writeU8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setUint8(this.pos, value);
        this.pos++;
      }
      writeU8a(values) {
        const size = values.length;
        this.ensureBufferSizeToWrite(size);
        this.bytes.set(values, this.pos);
        this.pos += size;
      }
      writeI8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setInt8(this.pos, value);
        this.pos++;
      }
      writeU16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setUint16(this.pos, value);
        this.pos += 2;
      }
      writeI16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setInt16(this.pos, value);
        this.pos += 2;
      }
      writeU32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setUint32(this.pos, value);
        this.pos += 4;
      }
      writeI32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setInt32(this.pos, value);
        this.pos += 4;
      }
      writeF32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setFloat32(this.pos, value);
        this.pos += 4;
      }
      writeF64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setFloat64(this.pos, value);
        this.pos += 8;
      }
      writeU64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setUint64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeI64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setInt64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeBigUint64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigUint64(this.pos, value);
        this.pos += 8;
      }
      writeBigInt64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigInt64(this.pos, value);
        this.pos += 8;
      }
    };
    exports2.Encoder = Encoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/encode.cjs
var require_encode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/encode.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.encode = encode;
    var Encoder_ts_1 = require_Encoder();
    function encode(value, options) {
      const encoder = new Encoder_ts_1.Encoder(options);
      return encoder.encodeSharedRef(value);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs
var require_prettyByte = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.prettyByte = prettyByte;
    function prettyByte(byte) {
      return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs
var require_CachedKeyDecoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CachedKeyDecoder = void 0;
    var utf8_ts_1 = require_utf8();
    var DEFAULT_MAX_KEY_LENGTH = 16;
    var DEFAULT_MAX_LENGTH_PER_KEY = 16;
    var CachedKeyDecoder = class {
      hit = 0;
      miss = 0;
      caches;
      maxKeyLength;
      maxLengthPerKey;
      constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
        this.maxKeyLength = maxKeyLength;
        this.maxLengthPerKey = maxLengthPerKey;
        this.caches = [];
        for (let i = 0; i < this.maxKeyLength; i++) {
          this.caches.push([]);
        }
      }
      canBeCached(byteLength) {
        return byteLength > 0 && byteLength <= this.maxKeyLength;
      }
      find(bytes, inputOffset, byteLength) {
        const records = this.caches[byteLength - 1];
        FIND_CHUNK: for (const record of records) {
          const recordBytes = record.bytes;
          for (let j = 0; j < byteLength; j++) {
            if (recordBytes[j] !== bytes[inputOffset + j]) {
              continue FIND_CHUNK;
            }
          }
          return record.str;
        }
        return null;
      }
      store(bytes, value) {
        const records = this.caches[bytes.length - 1];
        const record = { bytes, str: value };
        if (records.length >= this.maxLengthPerKey) {
          records[Math.random() * records.length | 0] = record;
        } else {
          records.push(record);
        }
      }
      decode(bytes, inputOffset, byteLength) {
        const cachedValue = this.find(bytes, inputOffset, byteLength);
        if (cachedValue != null) {
          this.hit++;
          return cachedValue;
        }
        this.miss++;
        const str = (0, utf8_ts_1.utf8DecodeJs)(bytes, inputOffset, byteLength);
        const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
        this.store(slicedCopyOfBytes, str);
        return str;
      }
    };
    exports2.CachedKeyDecoder = CachedKeyDecoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs
var require_Decoder = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Decoder = void 0;
    var prettyByte_ts_1 = require_prettyByte();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var utf8_ts_1 = require_utf8();
    var typedArrays_ts_1 = require_typedArrays();
    var CachedKeyDecoder_ts_1 = require_CachedKeyDecoder();
    var DecodeError_ts_1 = require_DecodeError();
    var STATE_ARRAY = "array";
    var STATE_MAP_KEY = "map_key";
    var STATE_MAP_VALUE = "map_value";
    var mapKeyConverter = (key) => {
      if (typeof key === "string" || typeof key === "number") {
        return key;
      }
      throw new DecodeError_ts_1.DecodeError("The type of key must be string or number but " + typeof key);
    };
    var StackPool = class {
      stack = [];
      stackHeadPosition = -1;
      get length() {
        return this.stackHeadPosition + 1;
      }
      top() {
        return this.stack[this.stackHeadPosition];
      }
      pushArrayState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_ARRAY;
        state.position = 0;
        state.size = size;
        state.array = new Array(size);
      }
      pushMapState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_MAP_KEY;
        state.readCount = 0;
        state.size = size;
        state.map = {};
      }
      getUninitializedStateFromPool() {
        this.stackHeadPosition++;
        if (this.stackHeadPosition === this.stack.length) {
          const partialState = {
            type: void 0,
            size: 0,
            array: void 0,
            position: 0,
            readCount: 0,
            map: void 0,
            key: null
          };
          this.stack.push(partialState);
        }
        return this.stack[this.stackHeadPosition];
      }
      release(state) {
        const topStackState = this.stack[this.stackHeadPosition];
        if (topStackState !== state) {
          throw new Error("Invalid stack state. Released state is not on top of the stack.");
        }
        if (state.type === STATE_ARRAY) {
          const partialState = state;
          partialState.size = 0;
          partialState.array = void 0;
          partialState.position = 0;
          partialState.type = void 0;
        }
        if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
          const partialState = state;
          partialState.size = 0;
          partialState.map = void 0;
          partialState.readCount = 0;
          partialState.type = void 0;
        }
        this.stackHeadPosition--;
      }
      reset() {
        this.stack.length = 0;
        this.stackHeadPosition = -1;
      }
    };
    var HEAD_BYTE_REQUIRED = -1;
    var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
    var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
    try {
      EMPTY_VIEW.getInt8(0);
    } catch (e) {
      if (!(e instanceof RangeError)) {
        throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
      }
    }
    var MORE_DATA = new RangeError("Insufficient data");
    var sharedCachedKeyDecoder = new CachedKeyDecoder_ts_1.CachedKeyDecoder();
    var Decoder = class _Decoder {
      extensionCodec;
      context;
      useBigInt64;
      rawStrings;
      maxStrLength;
      maxBinLength;
      maxArrayLength;
      maxMapLength;
      maxExtLength;
      keyDecoder;
      mapKeyConverter;
      totalPos = 0;
      pos = 0;
      view = EMPTY_VIEW;
      bytes = EMPTY_BYTES;
      headByte = HEAD_BYTE_REQUIRED;
      stack = new StackPool();
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.rawStrings = options?.rawStrings ?? false;
        this.maxStrLength = options?.maxStrLength ?? int_ts_1.UINT32_MAX;
        this.maxBinLength = options?.maxBinLength ?? int_ts_1.UINT32_MAX;
        this.maxArrayLength = options?.maxArrayLength ?? int_ts_1.UINT32_MAX;
        this.maxMapLength = options?.maxMapLength ?? int_ts_1.UINT32_MAX;
        this.maxExtLength = options?.maxExtLength ?? int_ts_1.UINT32_MAX;
        this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
        this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
      }
      clone() {
        return new _Decoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          rawStrings: this.rawStrings,
          maxStrLength: this.maxStrLength,
          maxBinLength: this.maxBinLength,
          maxArrayLength: this.maxArrayLength,
          maxMapLength: this.maxMapLength,
          maxExtLength: this.maxExtLength,
          keyDecoder: this.keyDecoder
        });
      }
      reinitializeState() {
        this.totalPos = 0;
        this.headByte = HEAD_BYTE_REQUIRED;
        this.stack.reset();
      }
      setBuffer(buffer) {
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = 0;
      }
      appendBuffer(buffer) {
        if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
          this.setBuffer(buffer);
        } else {
          const remainingData = this.bytes.subarray(this.pos);
          const newData = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
          const newBuffer = new Uint8Array(remainingData.length + newData.length);
          newBuffer.set(remainingData);
          newBuffer.set(newData, remainingData.length);
          this.setBuffer(newBuffer);
        }
      }
      hasRemaining(size) {
        return this.view.byteLength - this.pos >= size;
      }
      createExtraByteError(posToShow) {
        const { view, pos } = this;
        return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
      }
      /**
       * @throws {@link DecodeError}
       * @throws {@link RangeError}
       */
      decode(buffer) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decode(buffer);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          const object = this.doDecodeSync();
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.pos);
          }
          return object;
        } finally {
          this.entered = false;
        }
      }
      *decodeMulti(buffer) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMulti(buffer);
          return;
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          while (this.hasRemaining(1)) {
            yield this.doDecodeSync();
          }
        } finally {
          this.entered = false;
        }
      }
      async decodeAsync(stream) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decodeAsync(stream);
        }
        try {
          this.entered = true;
          let decoded = false;
          let object;
          for await (const buffer of stream) {
            if (decoded) {
              this.entered = false;
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            try {
              object = this.doDecodeSync();
              decoded = true;
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
          if (decoded) {
            if (this.hasRemaining(1)) {
              throw this.createExtraByteError(this.totalPos);
            }
            return object;
          }
          const { headByte, pos, totalPos } = this;
          throw new RangeError(`Insufficient data in parsing ${(0, prettyByte_ts_1.prettyByte)(headByte)} at ${totalPos} (${pos} in the current buffer)`);
        } finally {
          this.entered = false;
        }
      }
      decodeArrayStream(stream) {
        return this.decodeMultiAsync(stream, true);
      }
      decodeStream(stream) {
        return this.decodeMultiAsync(stream, false);
      }
      async *decodeMultiAsync(stream, isArray) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMultiAsync(stream, isArray);
          return;
        }
        try {
          this.entered = true;
          let isArrayHeaderRequired = isArray;
          let arrayItemsLeft = -1;
          for await (const buffer of stream) {
            if (isArray && arrayItemsLeft === 0) {
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            if (isArrayHeaderRequired) {
              arrayItemsLeft = this.readArraySize();
              isArrayHeaderRequired = false;
              this.complete();
            }
            try {
              while (true) {
                yield this.doDecodeSync();
                if (--arrayItemsLeft === 0) {
                  break;
                }
              }
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
        } finally {
          this.entered = false;
        }
      }
      doDecodeSync() {
        DECODE: while (true) {
          const headByte = this.readHeadByte();
          let object;
          if (headByte >= 224) {
            object = headByte - 256;
          } else if (headByte < 192) {
            if (headByte < 128) {
              object = headByte;
            } else if (headByte < 144) {
              const size = headByte - 128;
              if (size !== 0) {
                this.pushMapState(size);
                this.complete();
                continue DECODE;
              } else {
                object = {};
              }
            } else if (headByte < 160) {
              const size = headByte - 144;
              if (size !== 0) {
                this.pushArrayState(size);
                this.complete();
                continue DECODE;
              } else {
                object = [];
              }
            } else {
              const byteLength = headByte - 160;
              object = this.decodeString(byteLength, 0);
            }
          } else if (headByte === 192) {
            object = null;
          } else if (headByte === 194) {
            object = false;
          } else if (headByte === 195) {
            object = true;
          } else if (headByte === 202) {
            object = this.readF32();
          } else if (headByte === 203) {
            object = this.readF64();
          } else if (headByte === 204) {
            object = this.readU8();
          } else if (headByte === 205) {
            object = this.readU16();
          } else if (headByte === 206) {
            object = this.readU32();
          } else if (headByte === 207) {
            if (this.useBigInt64) {
              object = this.readU64AsBigInt();
            } else {
              object = this.readU64();
            }
          } else if (headByte === 208) {
            object = this.readI8();
          } else if (headByte === 209) {
            object = this.readI16();
          } else if (headByte === 210) {
            object = this.readI32();
          } else if (headByte === 211) {
            if (this.useBigInt64) {
              object = this.readI64AsBigInt();
            } else {
              object = this.readI64();
            }
          } else if (headByte === 217) {
            const byteLength = this.lookU8();
            object = this.decodeString(byteLength, 1);
          } else if (headByte === 218) {
            const byteLength = this.lookU16();
            object = this.decodeString(byteLength, 2);
          } else if (headByte === 219) {
            const byteLength = this.lookU32();
            object = this.decodeString(byteLength, 4);
          } else if (headByte === 220) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 221) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 222) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 223) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 196) {
            const size = this.lookU8();
            object = this.decodeBinary(size, 1);
          } else if (headByte === 197) {
            const size = this.lookU16();
            object = this.decodeBinary(size, 2);
          } else if (headByte === 198) {
            const size = this.lookU32();
            object = this.decodeBinary(size, 4);
          } else if (headByte === 212) {
            object = this.decodeExtension(1, 0);
          } else if (headByte === 213) {
            object = this.decodeExtension(2, 0);
          } else if (headByte === 214) {
            object = this.decodeExtension(4, 0);
          } else if (headByte === 215) {
            object = this.decodeExtension(8, 0);
          } else if (headByte === 216) {
            object = this.decodeExtension(16, 0);
          } else if (headByte === 199) {
            const size = this.lookU8();
            object = this.decodeExtension(size, 1);
          } else if (headByte === 200) {
            const size = this.lookU16();
            object = this.decodeExtension(size, 2);
          } else if (headByte === 201) {
            const size = this.lookU32();
            object = this.decodeExtension(size, 4);
          } else {
            throw new DecodeError_ts_1.DecodeError(`Unrecognized type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
          }
          this.complete();
          const stack = this.stack;
          while (stack.length > 0) {
            const state = stack.top();
            if (state.type === STATE_ARRAY) {
              state.array[state.position] = object;
              state.position++;
              if (state.position === state.size) {
                object = state.array;
                stack.release(state);
              } else {
                continue DECODE;
              }
            } else if (state.type === STATE_MAP_KEY) {
              if (object === "__proto__") {
                throw new DecodeError_ts_1.DecodeError("The key __proto__ is not allowed");
              }
              state.key = this.mapKeyConverter(object);
              state.type = STATE_MAP_VALUE;
              continue DECODE;
            } else {
              state.map[state.key] = object;
              state.readCount++;
              if (state.readCount === state.size) {
                object = state.map;
                stack.release(state);
              } else {
                state.key = null;
                state.type = STATE_MAP_KEY;
                continue DECODE;
              }
            }
          }
          return object;
        }
      }
      readHeadByte() {
        if (this.headByte === HEAD_BYTE_REQUIRED) {
          this.headByte = this.readU8();
        }
        return this.headByte;
      }
      complete() {
        this.headByte = HEAD_BYTE_REQUIRED;
      }
      readArraySize() {
        const headByte = this.readHeadByte();
        switch (headByte) {
          case 220:
            return this.readU16();
          case 221:
            return this.readU32();
          default: {
            if (headByte < 160) {
              return headByte - 144;
            } else {
              throw new DecodeError_ts_1.DecodeError(`Unrecognized array type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
            }
          }
        }
      }
      pushMapState(size) {
        if (size > this.maxMapLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
        }
        this.stack.pushMapState(size);
      }
      pushArrayState(size) {
        if (size > this.maxArrayLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
        }
        this.stack.pushArrayState(size);
      }
      decodeString(byteLength, headerOffset) {
        if (!this.rawStrings || this.stateIsMapKey()) {
          return this.decodeUtf8String(byteLength, headerOffset);
        }
        return this.decodeBinary(byteLength, headerOffset);
      }
      /**
       * @throws {@link RangeError}
       */
      decodeUtf8String(byteLength, headerOffset) {
        if (byteLength > this.maxStrLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
        }
        if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
          throw MORE_DATA;
        }
        const offset = this.pos + headerOffset;
        let object;
        if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
          object = this.keyDecoder.decode(this.bytes, offset, byteLength);
        } else {
          object = (0, utf8_ts_1.utf8Decode)(this.bytes, offset, byteLength);
        }
        this.pos += headerOffset + byteLength;
        return object;
      }
      stateIsMapKey() {
        if (this.stack.length > 0) {
          const state = this.stack.top();
          return state.type === STATE_MAP_KEY;
        }
        return false;
      }
      /**
       * @throws {@link RangeError}
       */
      decodeBinary(byteLength, headOffset) {
        if (byteLength > this.maxBinLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
        }
        if (!this.hasRemaining(byteLength + headOffset)) {
          throw MORE_DATA;
        }
        const offset = this.pos + headOffset;
        const object = this.bytes.subarray(offset, offset + byteLength);
        this.pos += headOffset + byteLength;
        return object;
      }
      decodeExtension(size, headOffset) {
        if (size > this.maxExtLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
        }
        const extType = this.view.getInt8(this.pos + headOffset);
        const data = this.decodeBinary(
          size,
          headOffset + 1
          /* extType */
        );
        return this.extensionCodec.decode(data, extType, this.context);
      }
      lookU8() {
        return this.view.getUint8(this.pos);
      }
      lookU16() {
        return this.view.getUint16(this.pos);
      }
      lookU32() {
        return this.view.getUint32(this.pos);
      }
      readU8() {
        const value = this.view.getUint8(this.pos);
        this.pos++;
        return value;
      }
      readI8() {
        const value = this.view.getInt8(this.pos);
        this.pos++;
        return value;
      }
      readU16() {
        const value = this.view.getUint16(this.pos);
        this.pos += 2;
        return value;
      }
      readI16() {
        const value = this.view.getInt16(this.pos);
        this.pos += 2;
        return value;
      }
      readU32() {
        const value = this.view.getUint32(this.pos);
        this.pos += 4;
        return value;
      }
      readI32() {
        const value = this.view.getInt32(this.pos);
        this.pos += 4;
        return value;
      }
      readU64() {
        const value = (0, int_ts_1.getUint64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readI64() {
        const value = (0, int_ts_1.getInt64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readU64AsBigInt() {
        const value = this.view.getBigUint64(this.pos);
        this.pos += 8;
        return value;
      }
      readI64AsBigInt() {
        const value = this.view.getBigInt64(this.pos);
        this.pos += 8;
        return value;
      }
      readF32() {
        const value = this.view.getFloat32(this.pos);
        this.pos += 4;
        return value;
      }
      readF64() {
        const value = this.view.getFloat64(this.pos);
        this.pos += 8;
        return value;
      }
    };
    exports2.Decoder = Decoder;
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decode.cjs
var require_decode = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decode.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decode = decode;
    exports2.decodeMulti = decodeMulti;
    var Decoder_ts_1 = require_Decoder();
    function decode(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decode(buffer);
    }
    function decodeMulti(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeMulti(buffer);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs
var require_stream = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isAsyncIterable = isAsyncIterable;
    exports2.asyncIterableFromStream = asyncIterableFromStream;
    exports2.ensureAsyncIterable = ensureAsyncIterable;
    function isAsyncIterable(object) {
      return object[Symbol.asyncIterator] != null;
    }
    async function* asyncIterableFromStream(stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
    function ensureAsyncIterable(streamLike) {
      if (isAsyncIterable(streamLike)) {
        return streamLike;
      } else {
        return asyncIterableFromStream(streamLike);
      }
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs
var require_decodeAsync = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decodeAsync = decodeAsync;
    exports2.decodeArrayStream = decodeArrayStream;
    exports2.decodeMultiStream = decodeMultiStream;
    var Decoder_ts_1 = require_Decoder();
    var stream_ts_1 = require_stream();
    async function decodeAsync(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeAsync(stream);
    }
    function decodeArrayStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeArrayStream(stream);
    }
    function decodeMultiStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeStream(stream);
    }
  }
});

// node_modules/@msgpack/msgpack/dist.cjs/index.cjs
var require_dist = __commonJS({
  "node_modules/@msgpack/msgpack/dist.cjs/index.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decodeTimestampExtension = exports2.encodeTimestampExtension = exports2.decodeTimestampToTimeSpec = exports2.encodeTimeSpecToTimestamp = exports2.encodeDateToTimeSpec = exports2.EXT_TIMESTAMP = exports2.ExtData = exports2.ExtensionCodec = exports2.Encoder = exports2.DecodeError = exports2.Decoder = exports2.decodeMultiStream = exports2.decodeArrayStream = exports2.decodeAsync = exports2.decodeMulti = exports2.decode = exports2.encode = void 0;
    var encode_ts_1 = require_encode();
    Object.defineProperty(exports2, "encode", { enumerable: true, get: function() {
      return encode_ts_1.encode;
    } });
    var decode_ts_1 = require_decode();
    Object.defineProperty(exports2, "decode", { enumerable: true, get: function() {
      return decode_ts_1.decode;
    } });
    Object.defineProperty(exports2, "decodeMulti", { enumerable: true, get: function() {
      return decode_ts_1.decodeMulti;
    } });
    var decodeAsync_ts_1 = require_decodeAsync();
    Object.defineProperty(exports2, "decodeAsync", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeAsync;
    } });
    Object.defineProperty(exports2, "decodeArrayStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeArrayStream;
    } });
    Object.defineProperty(exports2, "decodeMultiStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeMultiStream;
    } });
    var Decoder_ts_1 = require_Decoder();
    Object.defineProperty(exports2, "Decoder", { enumerable: true, get: function() {
      return Decoder_ts_1.Decoder;
    } });
    var DecodeError_ts_1 = require_DecodeError();
    Object.defineProperty(exports2, "DecodeError", { enumerable: true, get: function() {
      return DecodeError_ts_1.DecodeError;
    } });
    var Encoder_ts_1 = require_Encoder();
    Object.defineProperty(exports2, "Encoder", { enumerable: true, get: function() {
      return Encoder_ts_1.Encoder;
    } });
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    Object.defineProperty(exports2, "ExtensionCodec", { enumerable: true, get: function() {
      return ExtensionCodec_ts_1.ExtensionCodec;
    } });
    var ExtData_ts_1 = require_ExtData();
    Object.defineProperty(exports2, "ExtData", { enumerable: true, get: function() {
      return ExtData_ts_1.ExtData;
    } });
    var timestamp_ts_1 = require_timestamp();
    Object.defineProperty(exports2, "EXT_TIMESTAMP", { enumerable: true, get: function() {
      return timestamp_ts_1.EXT_TIMESTAMP;
    } });
    Object.defineProperty(exports2, "encodeDateToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeDateToTimeSpec;
    } });
    Object.defineProperty(exports2, "encodeTimeSpecToTimestamp", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimeSpecToTimestamp;
    } });
    Object.defineProperty(exports2, "decodeTimestampToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampToTimeSpec;
    } });
    Object.defineProperty(exports2, "encodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimestampExtension;
    } });
    Object.defineProperty(exports2, "decodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampExtension;
    } });
  }
});

// packages/relay/src/server.ts
var import_ws2 = require("ws");
var import_http = require("http");
var import_crypto3 = require("crypto");

// packages/types/src/protocol.ts
var MessageType = /* @__PURE__ */ ((MessageType2) => {
  MessageType2[MessageType2["DIRECT"] = 1] = "DIRECT";
  MessageType2[MessageType2["CHANNEL"] = 2] = "CHANNEL";
  MessageType2[MessageType2["RPC_REQUEST"] = 3] = "RPC_REQUEST";
  MessageType2[MessageType2["RPC_RESPONSE"] = 4] = "RPC_RESPONSE";
  MessageType2[MessageType2["SUBSCRIPTION"] = 5] = "SUBSCRIPTION";
  MessageType2[MessageType2["UNSUBSCRIPTION"] = 6] = "UNSUBSCRIPTION";
  MessageType2[MessageType2["PRESENCE"] = 7] = "PRESENCE";
  MessageType2[MessageType2["PING"] = 8] = "PING";
  MessageType2[MessageType2["ERROR"] = 9] = "ERROR";
  return MessageType2;
})(MessageType || {});
var FieldNames = {
  version: "v",
  messageType: "t",
  flags: "f",
  messageId: "id",
  senderId: "sid",
  receiverId: "rid",
  requestId: "rid_req",
  timestamp: "ts",
  sequence: "seq",
  ttl: "ttl",
  metadata: "meta",
  body: "body"
};

// packages/types/src/message.ts
var import_crypto = require("crypto");
function generateMessageId() {
  return (0, import_crypto.randomUUID)();
}
var Message = class _Message {
  constructor(envelope) {
    this.envelope = envelope;
  }
  /**
   * Create a DIRECT message (point-to-point)
   */
  static createDirect(senderId, receiverId, body, options) {
    const envelope = {
      v: 1,
      t: 1 /* DIRECT */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: receiverId,
      ts: Date.now(),
      seq: 0,
      ttl: 300,
      body,
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create a CHANNEL message (pub-sub broadcast)
   */
  static createChannel(senderId, channelName, body, options) {
    const envelope = {
      v: 1,
      t: 2 /* CHANNEL */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: channelName,
      ts: Date.now(),
      seq: 0,
      ttl: 600,
      body,
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create an RPC_REQUEST message
   */
  static createRpcRequest(senderId, receiverId, requestId, body, options) {
    const envelope = {
      v: 1,
      t: 3 /* RPC_REQUEST */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: receiverId,
      rid_req: requestId,
      ts: Date.now(),
      seq: 0,
      ttl: 30,
      body,
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create an RPC_RESPONSE message
   */
  static createRpcResponse(senderId, receiverId, requestId, body, options) {
    const envelope = {
      v: 1,
      t: 4 /* RPC_RESPONSE */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: receiverId,
      rid_req: requestId,
      ts: Date.now(),
      seq: 0,
      ttl: 30,
      body,
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create a SUBSCRIPTION message
   */
  static createSubscription(senderId, channelName, body, options) {
    const envelope = {
      v: 1,
      t: 5 /* SUBSCRIPTION */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: channelName,
      ts: Date.now(),
      seq: 0,
      ttl: 0,
      body: body || new Uint8Array(0),
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create an UNSUBSCRIPTION message
   */
  static createUnsubscription(senderId, channelName, options) {
    const envelope = {
      v: 1,
      t: 6 /* UNSUBSCRIPTION */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: channelName,
      ts: Date.now(),
      seq: 0,
      ttl: 0,
      body: new Uint8Array(0),
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create a PRESENCE message
   */
  static createPresence(senderId, body, options) {
    const envelope = {
      v: 1,
      t: 7 /* PRESENCE */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: "",
      ts: Date.now(),
      seq: 0,
      ttl: 60,
      body,
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create a PING message
   */
  static createPing(senderId, receiverId, options) {
    const envelope = {
      v: 1,
      t: 8 /* PING */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: receiverId,
      ts: Date.now(),
      seq: 0,
      ttl: 0,
      body: new Uint8Array(0),
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Create an ERROR message
   */
  static createError(senderId, receiverId, errorCode, description, relatedMessageId, options) {
    const envelope = {
      v: 1,
      t: 9 /* ERROR */,
      f: 0,
      id: generateMessageId(),
      sid: senderId,
      rid: receiverId,
      rid_req: relatedMessageId,
      ts: Date.now(),
      seq: 0,
      ttl: 0,
      meta: {
        error_code: errorCode,
        description,
        ...options?.meta
      },
      body: new Uint8Array(0),
      ...options
    };
    return new _Message(envelope);
  }
  /**
   * Get the envelope
   */
  toEnvelope() {
    return this.envelope;
  }
  /**
   * Get message type as string
   */
  getTypeName() {
    return MessageType[this.envelope.t];
  }
  /**
   * Check if message has compression flag set
   */
  isCompressed() {
    return (this.envelope.f & 2) !== 0;
  }
  /**
   * Check if message has authentication flag set
   */
  isAuthenticated() {
    return (this.envelope.f & 1) !== 0;
  }
};

// packages/types/src/codec.ts
var import_msgpack = __toESM(require_dist());
var Codec = class {
  /**
   * Encode a MessageEnvelope to MessagePack binary format
   *
   * Field order per spec: v, t, f, id, sid, rid, ts, seq, ttl, meta, body
   * Optional fields (rid_req, meta) included only if present
   */
  encode(envelope) {
    this.validateEnvelope(envelope);
    const wireFormat = {
      [FieldNames.version]: envelope.v,
      [FieldNames.messageType]: envelope.t,
      [FieldNames.flags]: envelope.f,
      [FieldNames.messageId]: envelope.id,
      [FieldNames.senderId]: envelope.sid,
      [FieldNames.receiverId]: envelope.rid,
      [FieldNames.timestamp]: envelope.ts,
      [FieldNames.sequence]: envelope.seq,
      [FieldNames.ttl]: envelope.ttl,
      [FieldNames.body]: envelope.body
    };
    if (envelope.rid_req !== void 0) {
      wireFormat[FieldNames.requestId] = envelope.rid_req;
    }
    if (envelope.meta !== void 0 && Object.keys(envelope.meta).length > 0) {
      wireFormat[FieldNames.metadata] = envelope.meta;
    }
    return (0, import_msgpack.encode)(wireFormat);
  }
  /**
   * Decode MessagePack binary data to MessageEnvelope
   *
   * @throws Error if data is malformed or invalid
   */
  decode(data) {
    let decoded;
    try {
      decoded = (0, import_msgpack.decode)(data);
    } catch (error) {
      throw new Error(`Failed to decode MessagePack: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error("Decoded data is not an object");
    }
    const d = decoded;
    const envelope = {
      v: d[FieldNames.version],
      t: d[FieldNames.messageType],
      f: d[FieldNames.flags],
      id: d[FieldNames.messageId],
      sid: d[FieldNames.senderId],
      rid: d[FieldNames.receiverId],
      ts: d[FieldNames.timestamp],
      seq: d[FieldNames.sequence],
      ttl: d[FieldNames.ttl],
      body: d[FieldNames.body]
    };
    if (d[FieldNames.requestId] !== void 0) {
      envelope.rid_req = d[FieldNames.requestId];
    }
    if (d[FieldNames.metadata] !== void 0) {
      envelope.meta = d[FieldNames.metadata];
    }
    this.validateEnvelope(envelope);
    return envelope;
  }
  /**
   * Validate a MessageEnvelope has all required fields and correct types
   *
   * @throws Error if validation fails
   */
  validateEnvelope(envelope) {
    if (typeof envelope.v !== "number" || envelope.v !== 1) {
      throw new Error(`Invalid version: expected 1, got ${envelope.v}`);
    }
    if (typeof envelope.t !== "number" || envelope.t < 1 || envelope.t > 9) {
      throw new Error(`Invalid message type: expected 1-9, got ${envelope.t}`);
    }
    if (typeof envelope.f !== "number" || envelope.f < 0 || envelope.f > 255) {
      throw new Error(`Invalid flags: expected 0-255, got ${envelope.f}`);
    }
    if (typeof envelope.id !== "string" || envelope.id.length === 0) {
      throw new Error("Invalid message ID: must be non-empty string");
    }
    if (typeof envelope.sid !== "string" || envelope.sid.length === 0) {
      throw new Error("Invalid sender ID: must be non-empty string");
    }
    if (typeof envelope.rid !== "string") {
      throw new Error("Invalid receiver ID: must be string");
    }
    if (envelope.t === 4 /* RPC_RESPONSE */ || envelope.t === 3 /* RPC_REQUEST */) {
      if (typeof envelope.rid_req !== "string" || envelope.rid_req.length === 0) {
        throw new Error("Request ID required for RPC messages");
      }
    }
    if (typeof envelope.ts !== "number" || envelope.ts < 0) {
      throw new Error("Invalid timestamp: must be non-negative number");
    }
    if (typeof envelope.seq !== "number" || envelope.seq < 0) {
      throw new Error("Invalid sequence: must be non-negative number");
    }
    if (typeof envelope.ttl !== "number" || envelope.ttl < 0 || envelope.ttl > 65535) {
      throw new Error("Invalid TTL: must be 0-65535");
    }
    if (envelope.meta !== void 0) {
      if (typeof envelope.meta !== "object" || envelope.meta === null) {
        throw new Error("Invalid metadata: must be object");
      }
      for (const [key, value] of Object.entries(envelope.meta)) {
        if (typeof key !== "string") {
          throw new Error("Invalid metadata: all keys must be strings");
        }
        const valueType = typeof value;
        if (valueType !== "string" && valueType !== "number" && valueType !== "boolean" && value !== null) {
          throw new Error(`Invalid metadata: value for key "${key}" must be string, number, boolean, or null`);
        }
      }
    }
    if (!(envelope.body instanceof Uint8Array)) {
      throw new Error("Invalid body: must be Uint8Array");
    }
  }
  /**
   * Return the encoded byte length of an envelope
   */
  estimateSize(envelope) {
    return this.encode(envelope).length;
  }
};
var codec = new Codec();

// packages/relay/src/connection-manager.ts
var ConnectionManager = class {
  connections = /* @__PURE__ */ new Map();
  agentIdIndex = /* @__PURE__ */ new Map();
  /**
   * Register a new agent connection.
   * @throws Error if session ID is already registered
   */
  register(sessionId, connection) {
    if (this.connections.has(sessionId)) {
      throw new Error(`Session ID ${sessionId} already registered`);
    }
    this.connections.set(sessionId, connection);
    this.agentIdIndex.set(connection.agentId, connection);
  }
  /**
   * Unregister a connection by session ID.
   * Removes from both indexes.
   */
  unregister(sessionId) {
    const conn = this.connections.get(sessionId);
    if (conn) {
      this.agentIdIndex.delete(conn.agentId);
    }
    return this.connections.delete(sessionId);
  }
  /**
   * Get connection by session ID (O(1)).
   */
  get(sessionId) {
    return this.connections.get(sessionId);
  }
  /**
   * Get connection by agent ID (O(1) via secondary index).
   */
  getByAgentId(agentId) {
    return this.agentIdIndex.get(agentId);
  }
  /**
   * Get all active connections.
   */
  getAll() {
    return Array.from(this.connections.values());
  }
  /**
   * Check if session is registered.
   */
  has(sessionId) {
    return this.connections.has(sessionId);
  }
  /**
   * Number of active connections.
   */
  get count() {
    return this.connections.size;
  }
  /**
   * Clear all connections (for testing).
   */
  clear() {
    this.connections.clear();
    this.agentIdIndex.clear();
  }
};

// packages/relay/src/router.ts
var import_crypto2 = require("crypto");

// packages/relay/src/channels.ts
var Channel = class {
  name;
  subscribers = /* @__PURE__ */ new Map();
  constructor(name) {
    this.name = name;
  }
  hasSubscriber(agentId) {
    return this.subscribers.has(agentId);
  }
  subscribe(agentId, connection) {
    this.subscribers.set(agentId, connection);
  }
  unsubscribe(agentId) {
    return this.subscribers.delete(agentId);
  }
  getSubscribers() {
    return Array.from(this.subscribers.keys());
  }
  getSubscriberCount() {
    return this.subscribers.size;
  }
  isEmpty() {
    return this.subscribers.size === 0;
  }
  broadcast(envelope) {
    const senderId = envelope.sid;
    const errors = [];
    let deliveredCount = 0;
    let failedCount = 0;
    for (const [agentId, connection] of this.subscribers) {
      if (agentId === senderId) continue;
      if (!connection.isActive()) continue;
      try {
        connection.send(envelope);
        deliveredCount++;
      } catch (error) {
        failedCount++;
        errors.push({
          agentId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
    return {
      success: true,
      channelName: this.name,
      subscriberCount: this.subscribers.size,
      deliveredCount,
      failedCount,
      errors
    };
  }
};
var ChannelManager = class {
  channels = /* @__PURE__ */ new Map();
  subscribe(channelName, agentId, connection) {
    if (!channelName || typeof channelName !== "string") {
      return { success: false, channelName: channelName || "", subscriberCount: 0, wasCreated: false, error: "Invalid channel name", errorCode: "INVALID_CHANNEL_NAME" };
    }
    let channel = this.channels.get(channelName);
    const wasCreated = !channel;
    if (!channel) {
      channel = new Channel(channelName);
      this.channels.set(channelName, channel);
    }
    channel.subscribe(agentId, connection);
    return { success: true, channelName, subscriberCount: channel.getSubscriberCount(), wasCreated };
  }
  unsubscribe(channelName, agentId) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return { success: false, channelName, subscriberCount: 0, wasDeleted: false, error: "Channel not found", errorCode: "CHANNEL_NOT_FOUND" };
    }
    const removed = channel.unsubscribe(agentId);
    if (!removed) {
      return { success: false, channelName, subscriberCount: channel.getSubscriberCount(), wasDeleted: false, error: "Agent not subscribed", errorCode: "NOT_SUBSCRIBED" };
    }
    const wasDeleted = channel.isEmpty();
    if (wasDeleted) {
      this.channels.delete(channelName);
    }
    return { success: true, channelName, subscriberCount: wasDeleted ? 0 : channel.getSubscriberCount(), wasDeleted };
  }
  unsubscribeAll(agentId) {
    const subscribed = [];
    for (const [channelName, channel] of this.channels) {
      if (channel.hasSubscriber(agentId)) {
        channel.unsubscribe(agentId);
        subscribed.push(channelName);
      }
    }
    for (const [channelName, channel] of this.channels) {
      if (channel.isEmpty()) {
        this.channels.delete(channelName);
      }
    }
    return subscribed;
  }
  broadcast(channelName, envelope) {
    const channel = this.channels.get(channelName);
    if (!channel) {
      return { success: true, channelName, subscriberCount: 0, deliveredCount: 0, failedCount: 0, errors: [] };
    }
    return channel.broadcast(envelope);
  }
  getSubscribers(channelName) {
    const channel = this.channels.get(channelName);
    return channel ? channel.getSubscribers() : [];
  }
  isSubscribed(channelName, agentId) {
    const channel = this.channels.get(channelName);
    return channel ? channel.hasSubscriber(agentId) : false;
  }
  getChannelCount() {
    return this.channels.size;
  }
  getChannelNames() {
    return Array.from(this.channels.keys());
  }
  clear() {
    this.channels.clear();
  }
};

// packages/relay/src/subscription-manager.ts
var SubscriptionManager = class {
  subscriptions = /* @__PURE__ */ new Map();
  addSubscription(agentId, channelName) {
    let channels = this.subscriptions.get(agentId);
    if (!channels) {
      channels = /* @__PURE__ */ new Set();
      this.subscriptions.set(agentId, channels);
    }
    channels.add(channelName);
  }
  removeSubscription(agentId, channelName) {
    const channels = this.subscriptions.get(agentId);
    if (!channels) return false;
    const removed = channels.delete(channelName);
    if (channels.size === 0) {
      this.subscriptions.delete(agentId);
    }
    return removed;
  }
  getSubscriptions(agentId) {
    return this.subscriptions.get(agentId) || /* @__PURE__ */ new Set();
  }
  hasSubscription(agentId, channelName) {
    const channels = this.subscriptions.get(agentId);
    return channels ? channels.has(channelName) : false;
  }
  /**
   * Remove all subscriptions for an agent.
   * Returns channel names the agent was subscribed to.
   */
  removeAllSubscriptions(agentId) {
    const channels = this.subscriptions.get(agentId);
    if (!channels) return [];
    const channelNames = Array.from(channels);
    this.subscriptions.delete(agentId);
    return channelNames;
  }
  getAgentCount() {
    return this.subscriptions.size;
  }
  getTotalSubscriptions() {
    let total = 0;
    for (const channels of this.subscriptions.values()) {
      total += channels.size;
    }
    return total;
  }
  getSubscriptionCount(agentId) {
    const channels = this.subscriptions.get(agentId);
    return channels ? channels.size : 0;
  }
  hasAnySubscriptions(agentId) {
    const channels = this.subscriptions.get(agentId);
    return channels ? channels.size > 0 : false;
  }
  clear() {
    this.subscriptions.clear();
  }
};

// packages/relay/src/presence.ts
var PresenceTracker = class {
  presence = /* @__PURE__ */ new Map();
  cleanupTimer = null;
  ttlMs;
  cleanupIntervalMs;
  constructor(config) {
    this.ttlMs = config?.ttlMs ?? 36e5;
    this.cleanupIntervalMs = config?.cleanupIntervalMs ?? 6e4;
    this.startCleanupTimer();
  }
  recordPresence(agentId, status, metadata) {
    this.presence.set(agentId, { agentId, status, lastSeen: Date.now(), metadata });
  }
  updateLastSeen(agentId) {
    const entry = this.presence.get(agentId);
    if (entry) {
      entry.lastSeen = Date.now();
    } else {
      this.recordPresence(agentId, "online");
    }
  }
  handlePresenceMessage(envelope) {
    try {
      let status = "online";
      let metadata;
      if (envelope.body && envelope.body.length > 0) {
        const bodyStr = new TextDecoder().decode(envelope.body);
        const bodyData = JSON.parse(bodyStr);
        status = bodyData.status || "online";
        metadata = bodyData.metadata;
      }
      if (envelope.meta) {
        metadata = { ...metadata, ...envelope.meta };
      }
      this.recordPresence(envelope.sid, status, metadata);
    } catch {
      this.recordPresence(envelope.sid, "online");
    }
  }
  getPresence(agentId) {
    return this.presence.get(agentId);
  }
  getAllPresence() {
    return Array.from(this.presence.values());
  }
  removePresence(agentId) {
    this.presence.delete(agentId);
  }
  isOnline(agentId) {
    const entry = this.presence.get(agentId);
    return entry ? entry.status === "online" : false;
  }
  getOnlineAgents() {
    return Array.from(this.presence.keys()).sort();
  }
  count() {
    return this.presence.size;
  }
  cleanup() {
    const now = Date.now();
    const expired = [];
    for (const [agentId, entry] of this.presence) {
      if (now - entry.lastSeen > this.ttlMs) {
        expired.push(agentId);
      }
    }
    for (const id of expired) {
      this.presence.delete(id);
    }
    return expired.length;
  }
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
  clear() {
    this.presence.clear();
  }
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
};

// packages/relay/src/router.ts
var MessageRouter = class {
  constructor(connectionManager) {
    this.connectionManager = connectionManager;
    this.channelManager = new ChannelManager();
    this.subscriptionManager = new SubscriptionManager();
    this.presenceTracker = new PresenceTracker();
  }
  channelManager;
  subscriptionManager;
  presenceTracker;
  metrics = {
    messagesRouted: 0,
    messagesByType: {},
    routingErrors: 0,
    averageLatencyMs: 0
  };
  totalLatency = 0;
  /**
   * Route an envelope to its destination. Sender must be pre-authenticated.
   */
  route(envelope, _sender) {
    const start = performance.now();
    try {
      switch (envelope.t) {
        case 1 /* DIRECT */:
          this.routeDirect(envelope);
          break;
        case 2 /* CHANNEL */:
          this.routeChannel(envelope);
          break;
        case 3 /* RPC_REQUEST */:
          this.routeToAgent(envelope);
          break;
        case 4 /* RPC_RESPONSE */:
          this.routeToAgent(envelope);
          break;
        case 5 /* SUBSCRIPTION */:
          this.handleSubscription(envelope);
          break;
        case 6 /* UNSUBSCRIPTION */:
          this.handleUnsubscription(envelope);
          break;
        case 7 /* PRESENCE */:
          this.handlePresence(envelope);
          break;
        case 8 /* PING */:
          this.handlePing(envelope);
          break;
        case 9 /* ERROR */:
          this.routeDirect(envelope);
          break;
        default:
          this.sendError(envelope.sid, "INVALID_TYPE", `Unknown message type: ${envelope.t}`, envelope.id);
      }
      const latencyMs = performance.now() - start;
      this.metrics.messagesRouted++;
      this.metrics.messagesByType[envelope.t] = (this.metrics.messagesByType[envelope.t] || 0) + 1;
      this.totalLatency += latencyMs;
      this.metrics.averageLatencyMs = this.totalLatency / this.metrics.messagesRouted;
    } catch (error) {
      this.metrics.routingErrors++;
      try {
        this.sendError(
          envelope.sid,
          "INTERNAL_ERROR",
          error instanceof Error ? error.message : "Unknown error",
          envelope.id
        );
      } catch {
      }
    }
  }
  routeDirect(envelope) {
    const receiver = this.connectionManager.getByAgentId(envelope.rid) || this.connectionManager.get(envelope.rid);
    if (!receiver || !receiver.isActive()) {
      this.sendError(envelope.sid, "AGENT_NOT_FOUND", `Agent ${envelope.rid} not connected`, envelope.id);
      return;
    }
    try {
      receiver.send(envelope);
    } catch (error) {
      this.sendError(
        envelope.sid,
        "DELIVERY_FAILED",
        error instanceof Error ? error.message : "Failed to deliver",
        envelope.id
      );
    }
  }
  routeToAgent(envelope) {
    const receiver = this.connectionManager.getByAgentId(envelope.rid) || this.connectionManager.get(envelope.rid);
    if (!receiver || !receiver.isActive()) {
      this.sendError(envelope.sid, "AGENT_NOT_FOUND", `Agent ${envelope.rid} not available`, envelope.id);
      return;
    }
    receiver.send(envelope);
  }
  routeChannel(envelope) {
    const result = this.channelManager.broadcast(envelope.rid, envelope);
    if (result.failedCount > 0) {
      console.warn(`[Router] Channel broadcast to "${envelope.rid}" had ${result.failedCount} failures`);
    }
  }
  handleSubscription(envelope) {
    const connection = this.connectionManager.getByAgentId(envelope.sid);
    if (!connection) return;
    this.channelManager.subscribe(envelope.rid, envelope.sid, connection);
    this.subscriptionManager.addSubscription(envelope.sid, envelope.rid);
  }
  handleUnsubscription(envelope) {
    this.channelManager.unsubscribe(envelope.rid, envelope.sid);
    this.subscriptionManager.removeSubscription(envelope.sid, envelope.rid);
  }
  handlePresence(envelope) {
    this.presenceTracker.handlePresenceMessage(envelope);
  }
  handlePing(envelope) {
    this.presenceTracker.updateLastSeen(envelope.sid);
    const requester = this.connectionManager.getByAgentId(envelope.sid) || this.connectionManager.get(envelope.sid);
    if (!requester || !requester.isActive()) return;
    const pong = {
      ...envelope,
      id: (0, import_crypto2.randomUUID)(),
      sid: "relay",
      rid: envelope.sid,
      ts: Date.now(),
      seq: 0
    };
    requester.send(pong);
  }
  sendError(toAgentId, errorCode, description, relatedMessageId) {
    const receiver = this.connectionManager.getByAgentId(toAgentId);
    if (!receiver || !receiver.isActive()) return;
    const errorMsg = {
      v: 1,
      t: 9 /* ERROR */,
      f: 0,
      id: (0, import_crypto2.randomUUID)(),
      sid: "relay",
      rid: toAgentId,
      rid_req: relatedMessageId,
      ts: Date.now(),
      seq: 0,
      ttl: 0,
      meta: { error_code: errorCode, description },
      body: new Uint8Array(0)
    };
    try {
      receiver.send(errorMsg);
    } catch {
    }
  }
  /**
   * Clean up all resources for a disconnecting agent.
   */
  onAgentDisconnect(sessionId) {
    const connection = this.connectionManager.get(sessionId);
    if (!connection) return;
    const agentId = connection.agentId;
    const channels = this.subscriptionManager.removeAllSubscriptions(agentId);
    for (const channelName of channels) {
      this.channelManager.unsubscribe(channelName, agentId);
    }
    this.presenceTracker.removePresence(agentId);
  }
  getMetrics() {
    return { ...this.metrics };
  }
  getChannelManager() {
    return this.channelManager;
  }
  getPresenceTracker() {
    return this.presenceTracker;
  }
};

// packages/relay/src/agent-connection.ts
var import_ws = require("ws");
var codec2 = new Codec();
var AgentConnection = class {
  sessionId;
  agentId;
  ws;
  seq = 0;
  active = true;
  constructor(sessionId, agentId, ws) {
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.ws = ws;
    ws.on("close", () => {
      this.active = false;
    });
  }
  /**
   * Send a MessageEnvelope to this agent via MessagePack encoding.
   */
  send(envelope) {
    if (!this.active || this.ws.readyState !== import_ws.WebSocket.OPEN) {
      throw new Error(`Cannot send to ${this.agentId}: connection not open`);
    }
    const data = codec2.encode(envelope);
    this.ws.send(data);
    this.seq++;
  }
  /**
   * Get next outgoing sequence number.
   */
  nextSeq() {
    return this.seq;
  }
  /**
   * Check if connection is still active.
   */
  isActive() {
    return this.active && this.ws.readyState === import_ws.WebSocket.OPEN;
  }
};

// packages/relay/src/server.ts
var RelayServer = class {
  constructor(config) {
    this.config = config;
    this.connectionManager = new ConnectionManager();
    this.router = new MessageRouter(this.connectionManager);
    this.authTimeoutMs = config.authTimeoutMs ?? 5e3;
  }
  wss;
  httpServer;
  connectionManager;
  router;
  codec = new Codec();
  _port = 0;
  authTimeoutMs;
  get port() {
    return this._port;
  }
  get url() {
    return `ws://localhost:${this._port}`;
  }
  async start() {
    return new Promise((resolve4) => {
      this.httpServer = (0, import_http.createServer)(this.handleHttp.bind(this));
      this.wss = new import_ws2.WebSocketServer({ server: this.httpServer });
      this.wss.on("connection", this.handleConnection.bind(this));
      this.httpServer.listen(this.config.port, this.config.host || "0.0.0.0", () => {
        const addr = this.httpServer.address();
        this._port = addr.port;
        resolve4();
      });
    });
  }
  async stop() {
    for (const client of this.wss.clients) {
      client.close(1001, "Server shutting down");
    }
    return new Promise((resolve4) => {
      this.wss.close(() => {
        this.httpServer.close(() => resolve4());
      });
    });
  }
  handleConnection(ws, _req) {
    let authenticated = false;
    let connection = null;
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        ws.close(1008, "Authentication timeout");
      }
    }, this.authTimeoutMs);
    ws.on("message", (data) => {
      try {
        if (!authenticated) {
          const authMsg = JSON.parse(data.toString());
          if (authMsg.type === "auth" && authMsg.agentId) {
            clearTimeout(authTimer);
            const sessionId = (0, import_crypto3.randomUUID)();
            connection = new AgentConnection(sessionId, authMsg.agentId, ws);
            this.connectionManager.register(sessionId, connection);
            authenticated = true;
            ws.send(JSON.stringify({ type: "auth_ok", sessionId, agentId: authMsg.agentId }));
            return;
          }
          ws.close(1008, "Authentication required");
          return;
        }
        const envelope = this.codec.decode(data);
        envelope.sid = connection.agentId;
        this.router.route(envelope, connection);
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      if (connection) {
        this.router.onAgentDisconnect(connection.sessionId);
        this.connectionManager.unregister(connection.sessionId);
      }
    });
    ws.on("error", () => {
      clearTimeout(authTimer);
      if (connection) {
        this.router.onAgentDisconnect(connection.sessionId);
        this.connectionManager.unregister(connection.sessionId);
      }
    });
  }
  handleHttp(req, res) {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connections: this.connectionManager.count }));
      return;
    }
    res.writeHead(404);
    res.end();
  }
};

// packages/client/src/gossip-agent.ts
var import_events = require("events");
var import_ws3 = __toESM(require("ws"));
var import_msgpack2 = __toESM(require_dist());
var WS_CLOSE_LABELS = {
  1e3: "NORMAL",
  1001: "GOING_AWAY",
  1002: "PROTOCOL_ERROR",
  1003: "UNSUPPORTED_DATA",
  1005: "NO_STATUS",
  1006: "ABNORMAL_CLOSE",
  1007: "INVALID_PAYLOAD",
  1008: "POLICY_VIOLATION",
  1009: "MESSAGE_TOO_BIG",
  1010: "MISSING_EXTENSION",
  1011: "INTERNAL_ERROR",
  1012: "SERVICE_RESTART",
  1013: "TRY_AGAIN_LATER",
  1014: "BAD_GATEWAY",
  1015: "TLS_HANDSHAKE_FAIL"
};
var GossipAgent = class extends import_events.EventEmitter {
  ws = null;
  codec = new Codec();
  config;
  seq = 0;
  reconnectAttempts = 0;
  reconnectTimer = null;
  keepAliveTimer = null;
  _connected = false;
  _sessionId = null;
  intentionalDisconnect = false;
  constructor(config) {
    super();
    this.config = {
      agentId: config.agentId,
      relayUrl: config.relayUrl,
      apiKey: config.apiKey ?? "",
      reconnect: config.reconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      reconnectBaseDelay: config.reconnectBaseDelay ?? 1e3,
      keepAliveInterval: config.keepAliveInterval ?? 3e4
    };
  }
  get agentId() {
    return this.config.agentId;
  }
  get sessionId() {
    return this._sessionId;
  }
  isConnected() {
    return this._connected && this.ws !== null && this.ws.readyState === import_ws3.default.OPEN;
  }
  // ─── Public API ─────────────────────────────────────────────────────────────
  connect() {
    return new Promise((resolve4, reject) => {
      const ws = new import_ws3.default(this.config.relayUrl);
      const timeout = setTimeout(() => {
        ws.removeAllListeners();
        ws.on("error", () => {
        });
        ws.close();
        reject(new Error("Connection timeout"));
      }, 1e4);
      ws.once("open", () => {
        ws.send(JSON.stringify({ type: "auth", agentId: this.config.agentId }));
      });
      ws.once("error", (err) => {
        clearTimeout(timeout);
        ws.removeAllListeners();
        reject(err);
      });
      ws.on("message", (data) => {
        if (!this._connected) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "auth_ok") {
              clearTimeout(timeout);
              this.ws = ws;
              this._connected = true;
              this._sessionId = msg.sessionId;
              this.reconnectAttempts = 0;
              ws.removeAllListeners("message");
              ws.on("message", (d) => this.handleMessage(d));
              ws.on("close", (code, reason) => this.handleClose(code, reason));
              this.startKeepAlive();
              this.emit("connect", msg.sessionId);
              resolve4();
            } else if (msg.type === "error") {
              clearTimeout(timeout);
              ws.removeAllListeners();
              ws.close();
              reject(new Error(msg.message ?? "Auth error"));
            }
          } catch (e) {
            clearTimeout(timeout);
            ws.removeAllListeners();
            ws.close();
            reject(e);
          }
          return;
        }
        this.handleMessage(data);
      });
    });
  }
  async disconnect() {
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (!this.ws) return;
    return new Promise((resolve4) => {
      this.intentionalDisconnect = true;
      this._connected = false;
      const ws = this.ws;
      this.ws = null;
      let settled = false;
      const done = (code = 1e3) => {
        if (settled) return;
        settled = true;
        this.intentionalDisconnect = false;
        this.emit("disconnect", code);
        resolve4();
      };
      const timer = setTimeout(() => done(1e3), 2e3);
      ws.once("close", (code) => {
        clearTimeout(timer);
        done(code);
      });
      ws.removeAllListeners("message");
      ws.close(1e3);
    });
  }
  async sendDirect(to, data) {
    const body = Buffer.from((0, import_msgpack2.encode)(data));
    const msg = Message.createDirect(this.config.agentId, to, body, { seq: this.seq++ });
    await this.sendEnvelope(msg.envelope);
  }
  async sendChannel(channel, data) {
    const ch = channel.replace(/^#/, "");
    const body = Buffer.from((0, import_msgpack2.encode)(data));
    const msg = Message.createChannel(this.config.agentId, ch, body, { seq: this.seq++ });
    await this.sendEnvelope(msg.envelope);
  }
  async subscribe(channel) {
    const ch = channel.replace(/^#/, "");
    const msg = Message.createSubscription(this.config.agentId, ch, void 0, { seq: this.seq++ });
    await this.sendEnvelope(msg.envelope);
  }
  async unsubscribe(channel) {
    const ch = channel.replace(/^#/, "");
    const msg = Message.createUnsubscription(this.config.agentId, ch, { seq: this.seq++ });
    await this.sendEnvelope(msg.envelope);
  }
  async sendEnvelope(envelope) {
    if (!this.isConnected()) {
      throw new Error("Not connected to relay");
    }
    const encoded = Buffer.from(this.codec.encode(envelope));
    return new Promise((resolve4, reject) => {
      this.ws.send(encoded, (err) => err ? reject(err) : resolve4());
    });
  }
  // ─── Internal ────────────────────────────────────────────────────────────────
  handleMessage(data) {
    try {
      const buf = data instanceof Buffer ? data : Buffer.from(data);
      const envelope = this.codec.decode(buf);
      let body = null;
      if (envelope.body && envelope.body.length > 0) {
        body = (0, import_msgpack2.decode)(envelope.body);
      }
      this.emit("message", body, envelope);
    } catch (err) {
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      } else {
        console.warn("[GossipAgent] Message decode error:", err.message);
      }
    }
  }
  handleClose(code, reason) {
    this.stopKeepAlive();
    this._connected = false;
    this.ws = null;
    const label = WS_CLOSE_LABELS[code] ?? "UNKNOWN";
    console.log(`[GossipAgent] Closed: ${label} (${code}) ${reason?.toString() || ""}`);
    if (!this.intentionalDisconnect) {
      this.emit("disconnect", code);
      this.attemptReconnect();
    }
  }
  attemptReconnect() {
    if (!this.config.reconnect || this.intentionalDisconnect) return;
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn(`[GossipAgent] Max reconnect attempts (${this.config.maxReconnectAttempts}) reached`);
      return;
    }
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
      3e4
    );
    this.reconnectAttempts++;
    console.log(`[GossipAgent] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalDisconnect) return;
      try {
        await this.connect();
        console.log("[GossipAgent] Reconnected");
      } catch (err) {
        console.warn(`[GossipAgent] Reconnect attempt ${this.reconnectAttempts} failed:`, err.message);
        this.attemptReconnect();
      }
    }, delay);
  }
  startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.isConnected()) return;
      const ping = Message.createPing(this.config.agentId, this.config.agentId, { seq: this.seq++ });
      this.sendEnvelope(ping.envelope).catch(() => {
      });
    }, this.config.keepAliveInterval);
  }
  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
  toString() {
    return `GossipAgent(${this.config.agentId})`;
  }
  toJSON() {
    return { agentId: this.config.agentId, connected: this.isConnected() };
  }
};

// packages/tools/src/tool-server.ts
var import_msgpack3 = __toESM(require_dist());

// packages/tools/src/file-tools.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var FileTools = class {
  constructor(sandbox) {
    this.sandbox = sandbox;
  }
  async fileRead(args) {
    const absPath = this.sandbox.validatePath(args.path);
    const content = await (0, import_promises.readFile)(absPath, "utf-8");
    if (args.startLine !== void 0 || args.endLine !== void 0) {
      const lines = content.split("\n");
      const start = (args.startLine || 1) - 1;
      const end = args.endLine || lines.length;
      return lines.slice(start, end).join("\n");
    }
    return content;
  }
  async fileWrite(args) {
    const absPath = this.sandbox.validatePath(args.path);
    const dir = (0, import_path.resolve)(absPath, "..");
    await (0, import_promises.mkdir)(dir, { recursive: true });
    await (0, import_promises.writeFile)(absPath, args.content, "utf-8");
    return `Written ${args.content.length} bytes to ${args.path}`;
  }
  async fileSearch(args) {
    const results = [];
    await this.walkDir(this.sandbox.projectRoot, args.pattern, results);
    return results.join("\n") || "No files found";
  }
  async fileGrep(args) {
    const searchRoot = args.path ? this.sandbox.validatePath(args.path) : this.sandbox.projectRoot;
    const regex = new RegExp(args.pattern);
    const results = [];
    await this.grepDir(searchRoot, regex, results);
    return results.join("\n") || "No matches found";
  }
  async fileTree(args) {
    const root = args.path ? this.sandbox.validatePath(args.path) : this.sandbox.projectRoot;
    const maxDepth = args.depth || 3;
    const lines = [];
    await this.buildTree(root, "", lines, 0, maxDepth);
    return lines.join("\n");
  }
  // ─── Private helpers ──────────────────────────────────────────────────────
  async walkDir(dir, pattern, results) {
    let entries;
    try {
      entries = await (0, import_promises.readdir)(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const fullPath = (0, import_path.join)(dir, entry);
      let info;
      try {
        info = await (0, import_promises.stat)(fullPath);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await this.walkDir(fullPath, pattern, results);
      } else {
        const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
        const regex = new RegExp(regexStr);
        const relPath = (0, import_path.relative)(this.sandbox.projectRoot, fullPath);
        if (regex.test(entry) || regex.test(relPath)) {
          results.push(relPath);
        }
      }
    }
  }
  async grepDir(dir, regex, results) {
    let entries;
    try {
      entries = await (0, import_promises.readdir)(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const fullPath = (0, import_path.join)(dir, entry);
      let info;
      try {
        info = await (0, import_promises.stat)(fullPath);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await this.grepDir(fullPath, regex, results);
      } else {
        try {
          const content = await (0, import_promises.readFile)(fullPath, "utf-8");
          const lines = content.split("\n");
          const relPath = (0, import_path.relative)(this.sandbox.projectRoot, fullPath);
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              results.push(`${relPath}:${idx + 1}: ${line}`);
            }
          });
        } catch {
        }
      }
    }
  }
  async buildTree(dir, prefix, lines, depth, maxDepth) {
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await (0, import_promises.readdir)(dir);
    } catch {
      return;
    }
    const filtered = entries.filter((e) => e !== "node_modules" && e !== ".git");
    for (let i = 0; i < filtered.length; i++) {
      const entry = filtered[i];
      const isLast = i === filtered.length - 1;
      const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 ";
      const fullPath = (0, import_path.join)(dir, entry);
      let info;
      try {
        info = await (0, import_promises.stat)(fullPath);
      } catch {
        continue;
      }
      lines.push(`${prefix}${connector}${entry}`);
      if (info.isDirectory()) {
        const childPrefix = prefix + (isLast ? "    " : "\u2502   ");
        await this.buildTree(fullPath, childPrefix, lines, depth + 1, maxDepth);
      }
    }
  }
};

// packages/tools/src/shell-tools.ts
var import_child_process = require("child_process");
var import_util = require("util");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
var DEFAULT_ALLOWED_COMMANDS = [
  "npm",
  "npx",
  "node",
  "git",
  "tsc",
  "jest",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "find",
  "grep",
  "echo",
  "pwd",
  "which",
  "env",
  "sleep"
];
var BLOCKED_PATTERNS = [
  /rm\s+(-rf|-fr|--force)/,
  /git\s+push\s+--force/,
  /git\s+reset\s+--hard/,
  /dd\s+if=/,
  /mkfs/,
  /:\(\)\s*\{.*\|.*&.*\}/
  // fork bomb
];
var ShellTools = class {
  allowedCommands;
  maxOutputSize;
  constructor(options) {
    this.allowedCommands = options?.allowedCommands || DEFAULT_ALLOWED_COMMANDS;
    this.maxOutputSize = options?.maxOutputSize || 1024 * 1024;
  }
  async shellExec(args) {
    const parts = args.command.trim().split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);
    if (!this.allowedCommands.includes(cmd)) {
      throw new Error(`Command "${cmd}" is not in the allowed commands list`);
    }
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(args.command)) {
        throw new Error(`Command blocked by safety rules: ${args.command}`);
      }
    }
    try {
      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        cwd: args.cwd,
        timeout: args.timeout || 3e4,
        maxBuffer: this.maxOutputSize,
        env: { ...process.env, FORCE_COLOR: "0" }
      });
      const output = stdout + (stderr ? `
STDERR:
${stderr}` : "");
      return output.slice(0, this.maxOutputSize);
    } catch (err) {
      const error = err;
      if (error.killed) return `Command timed out after ${args.timeout || 3e4}ms`;
      if (error.stdout || error.stderr) {
        const out = (error.stdout || "") + (error.stderr ? `
STDERR:
${error.stderr}` : "");
        return out.slice(0, this.maxOutputSize);
      }
      throw new Error(`Command failed: ${error.message}`);
    }
  }
};

// packages/tools/src/git-tools.ts
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var execFileAsync2 = (0, import_util2.promisify)(import_child_process2.execFile);
var GitTools = class {
  constructor(cwd) {
    this.cwd = cwd;
  }
  async git(...args) {
    try {
      const { stdout } = await execFileAsync2("git", args, { cwd: this.cwd });
      return stdout.trim();
    } catch (err) {
      const error = err;
      const msg = error.stderr ? error.stderr.trim() : error.message;
      throw new Error(`git ${args[0]} failed: ${msg}`);
    }
  }
  async gitStatus() {
    return this.git("status", "--short");
  }
  async gitDiff(args) {
    return args?.staged ? this.git("diff", "--staged") : this.git("diff");
  }
  async gitLog(args) {
    return this.git("log", "--oneline", `-${args?.count || 20}`);
  }
  async gitCommit(args) {
    if (args.files?.length) {
      await this.git("add", ...args.files);
    }
    return this.git("commit", "-m", args.message);
  }
  async gitBranch(args) {
    if (args?.name) {
      return this.git("checkout", "-b", args.name);
    }
    return this.git("branch", "--list");
  }
};

// packages/tools/src/sandbox.ts
var import_path2 = require("path");
var import_fs = require("fs");
var Sandbox = class {
  root;
  constructor(projectRoot) {
    this.root = (0, import_fs.realpathSync)((0, import_path2.resolve)(projectRoot));
  }
  get projectRoot() {
    return this.root;
  }
  /**
   * Validate that a path resolves within the project root.
   * Handles non-existent files (for file_write) by walking up to the
   * deepest existing ancestor and resolving from there.
   * Resolves symlinks to prevent symlink escape attacks.
   */
  validatePath(filePath) {
    const resolved = (0, import_path2.resolve)(this.root, filePath);
    let checkPath = resolved;
    while (!(0, import_fs.existsSync)(checkPath)) {
      const parent = (0, import_path2.dirname)(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    const real = (0, import_fs.existsSync)(checkPath) ? (0, import_fs.realpathSync)(checkPath) : checkPath;
    const remainder = resolved.slice(checkPath.length);
    const fullReal = real + remainder;
    if (!fullReal.startsWith(this.root + "/") && fullReal !== this.root) {
      throw new Error(`Path "${filePath}" resolves outside project root`);
    }
    return resolved;
  }
};

// packages/tools/src/tool-server.ts
var ToolServer = class {
  agent;
  fileTools;
  shellTools;
  gitTools;
  sandbox;
  constructor(config) {
    this.sandbox = new Sandbox(config.projectRoot);
    this.fileTools = new FileTools(this.sandbox);
    this.shellTools = new ShellTools();
    this.gitTools = new GitTools(config.projectRoot);
    this.agent = new GossipAgent({
      agentId: config.agentId || "tool-server",
      relayUrl: config.relayUrl,
      reconnect: true
    });
  }
  async start() {
    await this.agent.connect();
    this.agent.on("message", this.handleToolRequest.bind(this));
  }
  async stop() {
    await this.agent.disconnect();
  }
  get agentId() {
    return this.agent.agentId;
  }
  async handleToolRequest(data, envelope) {
    if (envelope.t !== 3 /* RPC_REQUEST */) return;
    const payload = data;
    const toolName = payload?.tool;
    const args = payload?.args || {};
    let result;
    let responsePayload;
    try {
      result = await this.executeTool(toolName, args);
      responsePayload = { result };
    } catch (err) {
      responsePayload = { error: err.message };
    }
    try {
      const body = Buffer.from((0, import_msgpack3.encode)(responsePayload));
      const correlationId = envelope.rid_req || envelope.id;
      const response = Message.createRpcResponse(
        this.agent.agentId,
        envelope.sid,
        // respond to the sender
        correlationId,
        // echo caller's correlation ID
        body
      );
      await this.agent.sendEnvelope(response.toEnvelope());
    } catch (sendErr) {
      console.error("[ToolServer] Failed to send RPC_RESPONSE:", sendErr.message);
    }
  }
  async executeTool(name, args) {
    switch (name) {
      case "file_read":
        return this.fileTools.fileRead(args);
      case "file_write":
        return this.fileTools.fileWrite(args);
      case "file_search":
        return this.fileTools.fileSearch(args);
      case "file_grep":
        return this.fileTools.fileGrep(args);
      case "file_tree":
        return this.fileTools.fileTree(args);
      case "shell_exec":
        return this.shellTools.shellExec({
          ...args,
          cwd: this.sandbox.projectRoot
        });
      case "git_status":
        return this.gitTools.gitStatus();
      case "git_diff":
        return this.gitTools.gitDiff(args);
      case "git_log":
        return this.gitTools.gitLog(args);
      case "git_commit":
        return this.gitTools.gitCommit(args);
      case "git_branch":
        return this.gitTools.gitBranch(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
};

// packages/tools/src/definitions.ts
var FILE_TOOLS = [
  {
    name: "file_read",
    description: "Read the contents of a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        startLine: { type: "string", description: "Optional start line number" },
        endLine: { type: "string", description: "Optional end line number" }
      },
      required: ["path"]
    }
  },
  {
    name: "file_write",
    description: "Write content to a file (creates parent directories if needed)",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Content to write to the file" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "file_search",
    description: "Search for files by name pattern (glob-style)",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: 'Glob-style pattern to match file names (e.g. "*.ts")' }
      },
      required: ["pattern"]
    }
  },
  {
    name: "file_grep",
    description: "Search file contents using a regex pattern",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for in file contents" },
        path: { type: "string", description: "Optional directory path to limit search scope" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "file_tree",
    description: "Display directory tree structure",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional directory path (defaults to project root)" },
        depth: { type: "string", description: "Optional max depth (default 3)" }
      },
      required: []
    }
  }
];
var SHELL_TOOLS = [
  {
    name: "shell_exec",
    description: "Execute a shell command in the project directory",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout: { type: "string", description: "Timeout in milliseconds (default 30000)" }
      },
      required: ["command"]
    }
  }
];
var GIT_TOOLS = [
  {
    name: "git_status",
    description: "Show working tree status (short format)",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "git_diff",
    description: "Show file differences",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "string", description: 'If "true", show staged differences' }
      },
      required: []
    }
  },
  {
    name: "git_log",
    description: "Show commit history",
    parameters: {
      type: "object",
      properties: {
        count: { type: "string", description: "Number of commits to show (default 20)" }
      },
      required: []
    }
  },
  {
    name: "git_commit",
    description: "Stage files and create a commit",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
        files: { type: "string", description: "Comma-separated list of files to stage (optional, stages all if omitted)" }
      },
      required: ["message"]
    }
  },
  {
    name: "git_branch",
    description: "List branches or create a new branch",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Branch name to create (optional, lists branches if omitted)" }
      },
      required: []
    }
  }
];
var ALL_TOOLS = [...FILE_TOOLS, ...SHELL_TOOLS, ...GIT_TOOLS];

// packages/orchestrator/src/llm-client.ts
var AnthropicProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async generate(messages, options) {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");
    const body = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: nonSystemMsgs.map((m) => this.toAnthropicMessage(m))
    };
    if (systemMsg) body.system = systemMsg.content;
    if (options?.temperature !== void 0) body.temperature = options.temperature;
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }));
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return this.parseAnthropicResponse(data);
  }
  toAnthropicMessage(m) {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      return { role: "assistant", content };
    }
    return { role: m.role, content: m.content };
  }
  parseAnthropicResponse(data) {
    const content = data.content;
    let text = "";
    const toolCalls = [];
    for (const block of content) {
      if (block.type === "text") text += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input
        });
      }
    }
    const usage = data.usage;
    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : void 0,
      usage: usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens } : void 0
    };
  }
};
var OpenAIProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async generate(messages, options) {
    const body = {
      model: this.model,
      messages: messages.map((m) => this.toOpenAIMessage(m))
    };
    if (options?.maxTokens) body.max_tokens = options.maxTokens;
    if (options?.temperature !== void 0) body.temperature = options.temperature;
    if (options?.tools?.length) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return this.parseOpenAIResponse(data);
  }
  toOpenAIMessage(m) {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      };
    }
    return { role: m.role, content: m.content };
  }
  parseOpenAIResponse(data) {
    const choices = data.choices;
    const msg = choices[0].message;
    const toolCalls = [];
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        const fn = tc.function;
        toolCalls.push({ id: tc.id, name: fn.name, arguments: JSON.parse(fn.arguments) });
      }
    }
    const usage = data.usage;
    return {
      text: msg.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : void 0,
      usage: usage ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens } : void 0
    };
  }
};
var GeminiProvider = class {
  constructor(apiKey, model) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async generate(messages, options) {
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    const systemMsg = messages.find((m) => m.role === "system");
    const body = { contents };
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    if (options?.temperature !== void 0) {
      body.generationConfig = { temperature: options.temperature, maxOutputTokens: options?.maxTokens ?? 4096 };
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const candidates = data.candidates;
    const parts = candidates[0].content.parts;
    return { text: parts.map((p) => p.text).join("") };
  }
};
var OllamaProvider = class {
  constructor(model, baseUrl = "http://localhost:11434") {
    this.model = model;
    this.baseUrl = baseUrl;
  }
  async generate(messages, options) {
    const body = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role === "tool" ? "user" : m.role, content: m.content })),
      stream: false
    };
    if (options?.temperature !== void 0) body.options = { temperature: options.temperature };
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    const msg = data.message;
    return { text: msg.content };
  }
};
function createProvider(provider, model, apiKey) {
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider(apiKey, model);
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "google":
      return new GeminiProvider(apiKey, model);
    case "local":
      return new OllamaProvider(model);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// packages/orchestrator/src/agent-registry.ts
var AgentRegistry = class {
  agents = /* @__PURE__ */ new Map();
  /** Register a new agent configuration */
  register(config) {
    this.agents.set(config.id, config);
  }
  /** Remove an agent by ID */
  unregister(id) {
    this.agents.delete(id);
  }
  /** Get agent config by ID */
  get(id) {
    return this.agents.get(id);
  }
  /** Get all registered agents */
  getAll() {
    return Array.from(this.agents.values());
  }
  /**
   * Find the agent with the most overlapping skills.
   * Returns null if no agents are registered.
   */
  findBestMatch(requiredSkills) {
    let bestMatch = null;
    let bestScore = 0;
    for (const agent of this.agents.values()) {
      const score = requiredSkills.filter((s) => agent.skills.includes(s)).length;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = agent;
      }
    }
    return bestMatch;
  }
  /** Find all agents that have a given skill */
  findBySkill(skill) {
    return this.getAll().filter((a) => a.skills.includes(skill));
  }
  /** Number of registered agents */
  get count() {
    return this.agents.size;
  }
};

// packages/orchestrator/src/task-dispatcher.ts
var import_crypto4 = require("crypto");
var TaskDispatcher = class {
  constructor(llm, registry) {
    this.llm = llm;
    this.registry = registry;
  }
  /**
   * Decompose a task into a DispatchPlan using the LLM.
   * On parse failure, falls back to a single sub-task.
   */
  async decompose(task) {
    const availableSkills = this.getAvailableSkills();
    const skillList = availableSkills.length > 0 ? availableSkills.join(", ") : "general";
    const messages = [
      {
        role: "system",
        content: `You are a task decomposition engine. Break the user's task into sub-tasks.
For each sub-task, specify required skills from: ${skillList}.
Respond in JSON format:
{
  "strategy": "single" | "parallel" | "sequential",
  "subTasks": [{ "description": "...", "requiredSkills": ["..."] }]
}
If the task is simple enough for one agent, use strategy "single" with one sub-task.`
      },
      { role: "user", content: task }
    ];
    const response = await this.llm.generate(messages, { temperature: 0 });
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const plan = JSON.parse(jsonMatch[0]);
      return {
        originalTask: task,
        strategy: plan.strategy || "single",
        subTasks: (plan.subTasks || []).map((st) => ({
          id: (0, import_crypto4.randomUUID)(),
          description: st.description,
          requiredSkills: st.requiredSkills || [],
          status: "pending"
        }))
      };
    } catch {
      return {
        originalTask: task,
        strategy: "single",
        subTasks: [{
          id: (0, import_crypto4.randomUUID)(),
          description: task,
          requiredSkills: [],
          status: "pending"
        }]
      };
    }
  }
  /**
   * Assign agents to each sub-task by skill match.
   * Modifies the plan in-place and returns it.
   */
  assignAgents(plan) {
    for (const subTask of plan.subTasks) {
      const match = this.registry.findBestMatch(subTask.requiredSkills);
      if (match) {
        subTask.assignedAgent = match.id;
      }
    }
    return plan;
  }
  /** Collect all unique skills from registered agents */
  getAvailableSkills() {
    const skills = /* @__PURE__ */ new Set();
    for (const agent of this.registry.getAll()) {
      agent.skills.forEach((s) => skills.add(s));
    }
    return Array.from(skills);
  }
};

// packages/orchestrator/src/worker-agent.ts
var import_crypto5 = require("crypto");
var import_msgpack4 = __toESM(require_dist());
var MAX_TOOL_TURNS = 10;
var TOOL_CALL_TIMEOUT_MS = 3e4;
var WorkerAgent = class {
  constructor(agentId, llm, relayUrl, tools) {
    this.agentId = agentId;
    this.llm = llm;
    this.tools = tools;
    this.agent = new GossipAgent({ agentId, relayUrl, reconnect: true });
  }
  agent;
  pendingToolCalls = /* @__PURE__ */ new Map();
  async start() {
    await this.agent.connect();
    this.agent.on("message", this.handleMessage.bind(this));
  }
  async stop() {
    await this.agent.disconnect();
  }
  /**
   * Execute a task with the LLM, using multi-turn tool calling.
   * Returns the final text response.
   */
  async executeTask(task, context) {
    const messages = [
      {
        role: "system",
        content: `You are a skilled developer agent. Complete the assigned task using the available tools. Be concise and focused.${context ? `

Context:
${context}` : ""}`
      },
      { role: "user", content: task }
    ];
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const response = await this.llm.generate(messages, { tools: this.tools });
      if (!response.toolCalls?.length) {
        return response.text;
      }
      messages.push({
        role: "assistant",
        content: response.text || "",
        toolCalls: response.toolCalls
      });
      for (const toolCall of response.toolCalls) {
        const result = await this.callTool(toolCall.name, toolCall.arguments);
        messages.push({
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
          name: toolCall.name
        });
      }
    }
    return "Max tool turns reached";
  }
  /** Send RPC_REQUEST to tool-server via relay */
  async callTool(name, args) {
    const requestId = (0, import_crypto5.randomUUID)();
    const resultPromise = new Promise((resolve4, reject) => {
      this.pendingToolCalls.set(requestId, { resolve: resolve4, reject });
      setTimeout(() => {
        if (this.pendingToolCalls.has(requestId)) {
          this.pendingToolCalls.delete(requestId);
          reject(new Error(`Tool call ${name} timed out`));
        }
      }, TOOL_CALL_TIMEOUT_MS);
    });
    const msg = Message.createRpcRequest(
      this.agentId,
      "tool-server",
      requestId,
      Buffer.from((0, import_msgpack4.encode)({ tool: name, args }))
    );
    await this.agent.sendEnvelope(msg.envelope);
    return resultPromise;
  }
  /** Handle incoming messages — resolve pending RPC tool calls */
  handleMessage(data, envelope) {
    if (envelope.t === 4 /* RPC_RESPONSE */ && envelope.rid_req) {
      const pending = this.pendingToolCalls.get(envelope.rid_req);
      if (pending) {
        this.pendingToolCalls.delete(envelope.rid_req);
        const payload = data;
        if (payload && typeof payload === "object") {
          if (payload.error) {
            pending.reject(new Error(payload.error));
          } else {
            pending.resolve(payload.result || "");
          }
        } else {
          const body = new TextDecoder().decode(envelope.body);
          try {
            const parsed = JSON.parse(body);
            if (parsed.error) {
              pending.reject(new Error(parsed.error));
            } else {
              pending.resolve(parsed.result || "");
            }
          } catch {
            pending.resolve(body);
          }
        }
      }
    }
  }
};

// packages/orchestrator/src/main-agent.ts
var CHAT_SYSTEM_PROMPT = `You are a developer assistant powering Gossip Mesh. Be concise and direct.

When you want to present the developer with choices, use this format in your response:

[CHOICES]
message: Your question here?
- option_value | Display Label | Optional hint text
- option_value | Display Label | Optional hint
[/CHOICES]

Examples of when to use choices:
- Multiple approaches to a task (refactor in-place vs extract vs rewrite)
- Confirming a destructive action (delete files, reset branch)
- Selecting which files/modules to work on
- Choosing between trade-offs (speed vs thoroughness)

Only present choices when there's a genuine decision. Don't use them for simple yes/no \u2014 just ask directly.
When there's a clear best option, recommend it but still offer alternatives.`;
var MainAgent = class {
  llm;
  registry;
  dispatcher;
  workers = /* @__PURE__ */ new Map();
  relayUrl;
  constructor(config) {
    this.llm = createProvider(config.provider, config.model, config.apiKey);
    this.registry = new AgentRegistry();
    this.dispatcher = new TaskDispatcher(this.llm, this.registry);
    this.relayUrl = config.relayUrl;
    for (const agent of config.agents) {
      this.registry.register(agent);
    }
  }
  /** Start all worker agents (connect to relay) */
  async start() {
    for (const config of this.registry.getAll()) {
      const llm = createProvider(config.provider, config.model);
      const worker = new WorkerAgent(config.id, llm, this.relayUrl, ALL_TOOLS);
      await worker.start();
      this.workers.set(config.id, worker);
    }
  }
  /** Stop all worker agents */
  async stop() {
    for (const worker of this.workers.values()) {
      await worker.stop();
    }
    this.workers.clear();
  }
  /** Handle a user message: decompose, dispatch, synthesize. Returns structured ChatResponse. */
  async handleMessage(userMessage) {
    const plan = await this.dispatcher.decompose(userMessage);
    this.dispatcher.assignAgents(plan);
    const unassigned = plan.subTasks.filter((st) => !st.assignedAgent);
    if (unassigned.length === plan.subTasks.length) {
      const response = await this.llm.generate([
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: userMessage }
      ]);
      return this.parseResponse(response.text);
    }
    if (plan.subTasks.length > 1 && plan.strategy !== "parallel") {
      const planSummary = plan.subTasks.map((st, i) => `${i + 1}. ${st.description}`).join("\n");
      await this.llm.generate([
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
        { role: "assistant", content: `I've broken this into steps:
${planSummary}

Should I present these as choices to the developer, or just execute them all?` }
      ]);
    }
    const results = [];
    const assigned = plan.subTasks.filter((st) => st.assignedAgent);
    if (plan.strategy === "parallel") {
      const promises = assigned.map((subTask) => this.executeSubTask(subTask));
      results.push(...await Promise.all(promises));
    } else {
      for (const subTask of assigned) {
        results.push(await this.executeSubTask(subTask));
      }
    }
    const text = await this.synthesize(userMessage, results);
    return {
      text,
      status: "done",
      agents: results.map((r) => r.agentId)
    };
  }
  /** Handle a user's choice selection — continues the conversation with context */
  async handleChoice(originalMessage, choiceValue) {
    const response = await this.llm.generate([
      { role: "system", content: CHAT_SYSTEM_PROMPT },
      { role: "user", content: originalMessage },
      { role: "assistant", content: `I presented options and the developer chose: "${choiceValue}". Proceeding with that approach.` },
      { role: "user", content: `Yes, go with "${choiceValue}".` }
    ]);
    return this.parseResponse(response.text);
  }
  /**
   * Parse LLM response for structured elements.
   * Detects choice blocks in the format:
   *   [CHOICES]
   *   message: How should I proceed?
   *   - option_value | Display Label | Optional hint
   *   - option_value | Display Label
   *   [/CHOICES]
   */
  parseResponse(text) {
    const choiceMatch = text.match(/\[CHOICES\]([\s\S]*?)\[\/CHOICES\]/);
    if (!choiceMatch) {
      return { text, status: "done" };
    }
    const choiceBlock = choiceMatch[1].trim();
    const lines = choiceBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    const messageLine = lines.find((l) => l.startsWith("message:"));
    const optionLines = lines.filter((l) => l.startsWith("- "));
    const message = messageLine?.replace("message:", "").trim() || "How should I proceed?";
    const options = optionLines.map((line) => {
      const parts = line.slice(2).split("|").map((p) => p.trim());
      return {
        value: parts[0],
        label: parts[1] || parts[0],
        hint: parts[2]
      };
    });
    const textBefore = text.slice(0, text.indexOf("[CHOICES]")).trim();
    const textAfter = text.slice(text.indexOf("[/CHOICES]") + "[/CHOICES]".length).trim();
    const cleanText = [textBefore, textAfter].filter(Boolean).join("\n\n");
    return {
      text: cleanText,
      choices: options.length > 0 ? { message, options, allowCustom: true, type: "select" } : void 0,
      status: "done"
    };
  }
  async executeSubTask(subTask) {
    const worker = this.workers.get(subTask.assignedAgent);
    if (!worker) {
      return { agentId: "unknown", task: subTask.description, result: "", error: "No worker", duration: 0 };
    }
    const start = Date.now();
    try {
      const result = await worker.executeTask(subTask.description);
      return { agentId: subTask.assignedAgent, task: subTask.description, result, duration: Date.now() - start };
    } catch (err) {
      return {
        agentId: subTask.assignedAgent,
        task: subTask.description,
        result: "",
        error: err.message,
        duration: Date.now() - start
      };
    }
  }
  async synthesize(originalTask, results) {
    if (results.length === 1) {
      return results[0].error || results[0].result;
    }
    const summaryPrompt = results.map(
      (r) => `Agent ${r.agentId} (${r.duration}ms):
${r.error ? `ERROR: ${r.error}` : r.result}`
    ).join("\n\n---\n\n");
    const response = await this.llm.generate([
      { role: "system", content: "Synthesize the following agent results into a single coherent response. Be concise." },
      { role: "user", content: `Original task: ${originalTask}

Agent results:
${summaryPrompt}` }
    ]);
    return response.text;
  }
};

// apps/cli/src/config.ts
var import_fs2 = require("fs");
var import_path3 = require("path");
function findConfigPath() {
  const candidates = [
    (0, import_path3.resolve)(process.cwd(), "gossip.agents.json"),
    (0, import_path3.resolve)(process.cwd(), "gossip.agents.yaml"),
    (0, import_path3.resolve)(process.cwd(), "gossip.agents.yml")
  ];
  for (const path of candidates) {
    if ((0, import_fs2.existsSync)(path)) return path;
  }
  return null;
}
function loadConfig(configPath) {
  const raw = (0, import_fs2.readFileSync)(configPath, "utf-8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse config at ${configPath}. Use JSON format for gossip.agents.json.`);
  }
  return validateConfig(parsed);
}
var VALID_PROVIDERS = ["anthropic", "openai", "google", "local"];
function validateConfig(raw) {
  if (!raw.main_agent) throw new Error('Config missing "main_agent" field');
  if (!raw.main_agent.provider) throw new Error('Config missing "main_agent.provider"');
  if (!raw.main_agent.model) throw new Error('Config missing "main_agent.model"');
  if (!VALID_PROVIDERS.includes(raw.main_agent.provider)) {
    throw new Error(
      `Invalid provider "${raw.main_agent.provider}". Must be one of: ${VALID_PROVIDERS.join(", ")}`
    );
  }
  if (raw.agents) {
    for (const [id, agent] of Object.entries(raw.agents)) {
      if (!agent.provider) throw new Error(`Agent "${id}" missing provider`);
      if (!VALID_PROVIDERS.includes(agent.provider)) {
        throw new Error(`Agent "${id}" has invalid provider "${agent.provider}"`);
      }
      if (!agent.skills || !Array.isArray(agent.skills) || agent.skills.length === 0) {
        throw new Error(`Agent "${id}" must have at least one skill`);
      }
    }
  }
  return raw;
}
function configToAgentConfigs(config) {
  return Object.entries(config.agents || {}).map(([id, agent]) => ({
    id,
    provider: agent.provider,
    model: agent.model,
    preset: agent.preset,
    skills: agent.skills
  }));
}

// apps/cli/src/keychain.ts
var import_child_process3 = require("child_process");
var import_os = require("os");
var SERVICE_NAME = "gossip-mesh";
var Keychain = class {
  inMemoryStore = /* @__PURE__ */ new Map();
  useKeychain;
  constructor() {
    this.useKeychain = this.isKeychainAvailable();
    if (!this.useKeychain) {
      console.warn("[Keychain] OS keychain not available. Keys stored in memory only (not persisted).");
    }
  }
  async getKey(provider) {
    if (this.useKeychain) {
      try {
        return this.readFromKeychain(provider);
      } catch {
        return this.inMemoryStore.get(provider) || null;
      }
    }
    return this.inMemoryStore.get(provider) || null;
  }
  async setKey(provider, key) {
    this.inMemoryStore.set(provider, key);
    if (this.useKeychain) {
      try {
        this.writeToKeychain(provider, key);
      } catch {
        console.warn(`[Keychain] Failed to write to OS keychain. Key for ${provider} stored in memory only.`);
      }
    }
  }
  isKeychainAvailable() {
    if ((0, import_os.platform)() === "darwin") {
      try {
        (0, import_child_process3.execFileSync)("security", ["help"], { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    }
    if ((0, import_os.platform)() === "linux") {
      try {
        (0, import_child_process3.execFileSync)("which", ["secret-tool"], { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  readFromKeychain(provider) {
    if ((0, import_os.platform)() === "darwin") {
      return (0, import_child_process3.execFileSync)("security", [
        "find-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        provider,
        "-w"
      ], { stdio: "pipe" }).toString().trim();
    }
    if ((0, import_os.platform)() === "linux") {
      return (0, import_child_process3.execFileSync)("secret-tool", [
        "lookup",
        "service",
        SERVICE_NAME,
        "provider",
        provider
      ], { stdio: "pipe" }).toString().trim();
    }
    throw new Error("Unsupported platform");
  }
  writeToKeychain(provider, key) {
    if ((0, import_os.platform)() === "darwin") {
      try {
        (0, import_child_process3.execFileSync)("security", [
          "delete-generic-password",
          "-s",
          SERVICE_NAME,
          "-a",
          provider
        ], { stdio: "pipe" });
      } catch {
      }
      (0, import_child_process3.execFileSync)("security", [
        "add-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        provider,
        "-w",
        key
      ], { stdio: "pipe" });
      return;
    }
    if ((0, import_os.platform)() === "linux") {
      (0, import_child_process3.execFileSync)("secret-tool", [
        "store",
        "--label",
        `Gossip Mesh ${provider}`,
        "service",
        SERVICE_NAME,
        "provider",
        provider
      ], { input: key, stdio: ["pipe", "pipe", "pipe"] });
      return;
    }
  }
};

// apps/cli/src/mcp-server.ts
var import_crypto6 = require("crypto");
var MCP_TOOLS = [
  // ── High-level (includes orchestrator LLM) ──────────────────────────────
  {
    name: "gossip_orchestrate",
    description: "HIGH-LEVEL: Submit a task to the Gossip Mesh orchestrator. It decomposes the task, assigns sub-tasks to agents, and returns the synthesized result. Use when you want gossipcat to handle everything automatically.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The task to execute." }
      },
      required: ["task"]
    }
  },
  // ── Low-level (IDE is the orchestrator) ─────────────────────────────────
  {
    name: "gossip_dispatch",
    description: "LOW-LEVEL: Send a task directly to a specific agent by ID. Returns a task ID for collecting results later. The IDE controls decomposition and assignment \u2014 gossipcat just executes. Use gossip_agents first to see available agents.",
    inputSchema: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: 'Agent ID to dispatch to (e.g. "local-reviewer", "gpt-implementer")' },
        task: { type: "string", description: "The task for this agent to execute." },
        context: { type: "string", description: "Optional context (e.g. file contents, prior results from other agents)." }
      },
      required: ["agent_id", "task"]
    }
  },
  {
    name: "gossip_dispatch_parallel",
    description: "LOW-LEVEL: Fan out multiple tasks to multiple agents simultaneously. Returns task IDs for each. Use when you want several agents working in parallel (e.g. security review + performance review).",
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description: "Array of { agent_id, task, context? } objects to dispatch.",
          items: {
            type: "object",
            properties: {
              agent_id: { type: "string", description: "Agent ID" },
              task: { type: "string", description: "Task for this agent" },
              context: { type: "string", description: "Optional context" }
            },
            required: ["agent_id", "task"]
          }
        }
      },
      required: ["tasks"]
    }
  },
  {
    name: "gossip_collect",
    description: "LOW-LEVEL: Collect results from dispatched tasks. Can wait for specific tasks or all pending tasks. Returns results for completed tasks and status for still-running ones.",
    inputSchema: {
      type: "object",
      properties: {
        task_ids: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs to collect. Omit to collect all pending tasks."
        },
        wait: {
          type: "boolean",
          description: "If true, wait for tasks to complete (up to timeout). Default: true."
        },
        timeout_ms: {
          type: "number",
          description: "Max time to wait in milliseconds. Default: 120000 (2 min)."
        }
      }
    }
  },
  // ── Info tools ──────────────────────────────────────────────────────────
  {
    name: "gossip_agents",
    description: "List all configured agents with their provider, model, role, and skills. Use before gossip_dispatch to know what agents are available.",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "gossip_status",
    description: "Check Gossip Mesh status: relay, tool server, connected agents, pending tasks.",
    inputSchema: { type: "object", properties: {}, required: [] }
  }
];
var GossipMcpServer = class {
  relay = null;
  toolServer = null;
  mainAgent = null;
  workers = /* @__PURE__ */ new Map();
  tasks = /* @__PURE__ */ new Map();
  initialized = false;
  keychain = new Keychain();
  async handleRequest(request) {
    try {
      switch (request.method) {
        case "initialize":
          return this.respond(request.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "gossipcat", version: "0.1.0" }
          });
        case "notifications/initialized":
          return null;
        case "tools/list":
          return this.respond(request.id, { tools: MCP_TOOLS });
        case "tools/call":
          return await this.handleToolCall(request);
        default:
          return this.respondError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      return this.respondError(request.id, -32603, err.message);
    }
  }
  async handleToolCall(request) {
    const params = request.params;
    const name = params?.name;
    const args = params?.arguments || {};
    if (!this.initialized && name !== "gossip_agents") {
      await this.boot();
    }
    switch (name) {
      case "gossip_orchestrate":
        return this.handleOrchestrate(request.id, args);
      case "gossip_dispatch":
        return this.handleDispatch(request.id, args);
      case "gossip_dispatch_parallel":
        return this.handleDispatchParallel(request.id, args);
      case "gossip_collect":
        return this.handleCollect(request.id, args);
      case "gossip_agents":
        return this.handleAgents(request.id);
      case "gossip_status":
        return this.handleStatus(request.id);
      default:
        return this.respondError(request.id, -32602, `Unknown tool: ${String(name)}`);
    }
  }
  // ── High-level: full orchestration ──────────────────────────────────────
  async handleOrchestrate(id, args) {
    if (!this.mainAgent) {
      return this.text(id, "Error: MainAgent not initialized. Is gossip.agents.json configured?");
    }
    try {
      const response = await this.mainAgent.handleMessage(args.task);
      const suffix = response.agents?.length ? `

[Agents: ${response.agents.join(", ")}]` : "";
      return this.text(id, response.text + suffix);
    } catch (err) {
      return this.text(id, `Orchestration error: ${err.message}`);
    }
  }
  // ── Low-level: dispatch to specific agent ───────────────────────────────
  async handleDispatch(id, args) {
    const agentId = args.agent_id;
    const task = args.task;
    const context = args.context;
    const worker = this.workers.get(agentId);
    if (!worker) {
      const available = Array.from(this.workers.keys()).join(", ");
      return this.text(id, `Agent "${agentId}" not found. Available: ${available}`);
    }
    const taskId = (0, import_crypto6.randomUUID)().slice(0, 8);
    const dispatched = {
      id: taskId,
      agentId,
      task,
      status: "running",
      startedAt: Date.now(),
      promise: null
      // set below
    };
    dispatched.promise = worker.executeTask(task, context).then((result) => {
      dispatched.status = "completed";
      dispatched.result = result;
      dispatched.completedAt = Date.now();
    }).catch((err) => {
      dispatched.status = "failed";
      dispatched.error = err.message;
      dispatched.completedAt = Date.now();
    });
    this.tasks.set(taskId, dispatched);
    return this.text(id, `Dispatched to ${agentId}. Task ID: ${taskId}`);
  }
  // ── Low-level: parallel dispatch ────────────────────────────────────────
  async handleDispatchParallel(id, args) {
    const taskDefs = args.tasks;
    if (!taskDefs?.length) {
      return this.text(id, "No tasks provided.");
    }
    const taskIds = [];
    const errors = [];
    for (const def of taskDefs) {
      const worker = this.workers.get(def.agent_id);
      if (!worker) {
        errors.push(`Agent "${def.agent_id}" not found`);
        continue;
      }
      const taskId = (0, import_crypto6.randomUUID)().slice(0, 8);
      const dispatched = {
        id: taskId,
        agentId: def.agent_id,
        task: def.task,
        status: "running",
        startedAt: Date.now(),
        promise: null
      };
      dispatched.promise = worker.executeTask(def.task, def.context).then((result) => {
        dispatched.status = "completed";
        dispatched.result = result;
        dispatched.completedAt = Date.now();
      }).catch((err) => {
        dispatched.status = "failed";
        dispatched.error = err.message;
        dispatched.completedAt = Date.now();
      });
      this.tasks.set(taskId, dispatched);
      taskIds.push(taskId);
    }
    let msg = `Dispatched ${taskIds.length} tasks:
${taskIds.map((tid, i) => `  ${tid} \u2192 ${taskDefs[i].agent_id}`).join("\n")}`;
    if (errors.length) msg += `

Errors:
${errors.join("\n")}`;
    return this.text(id, msg);
  }
  // ── Low-level: collect results ──────────────────────────────────────────
  async handleCollect(id, args) {
    const taskIds = args.task_ids;
    const wait = args.wait !== false;
    const timeoutMs = args.timeout_ms || 12e4;
    const targets = taskIds ? taskIds.map((tid) => this.tasks.get(tid)).filter(Boolean) : Array.from(this.tasks.values()).filter((t) => t.status === "running");
    if (targets.length === 0) {
      return this.text(id, taskIds ? "No matching tasks found." : "No pending tasks.");
    }
    if (wait) {
      await Promise.race([
        Promise.all(targets.map((t) => t.promise)),
        new Promise((r) => setTimeout(r, timeoutMs))
      ]);
    }
    const results = targets.map((t) => {
      const duration = t.completedAt ? `${t.completedAt - t.startedAt}ms` : "still running";
      if (t.status === "completed") {
        return `[${t.id}] ${t.agentId} (${duration}):
${t.result}`;
      } else if (t.status === "failed") {
        return `[${t.id}] ${t.agentId} (${duration}): ERROR: ${t.error}`;
      } else {
        return `[${t.id}] ${t.agentId}: still running...`;
      }
    });
    for (const t of targets) {
      if (t.status !== "running") this.tasks.delete(t.id);
    }
    return this.text(id, results.join("\n\n---\n\n"));
  }
  // ── Info: list agents ───────────────────────────────────────────────────
  handleAgents(id) {
    const configPath = findConfigPath();
    if (!configPath) {
      return this.text(id, "No gossip.agents.json found. Run gossipcat setup first.");
    }
    const config = loadConfig(configPath);
    const agents = configToAgentConfigs(config);
    const list = agents.map(
      (a) => `- ${a.id}: ${a.provider}/${a.model} (${a.preset || "custom"}) \u2014 skills: ${a.skills.join(", ")}`
    ).join("\n");
    return this.text(id, `Orchestrator: ${config.main_agent.model} (${config.main_agent.provider})

Agents:
${list}`);
  }
  // ── Info: system status ─────────────────────────────────────────────────
  handleStatus(id) {
    const pendingTasks = Array.from(this.tasks.values()).filter((t) => t.status === "running");
    return this.text(id, [
      "Gossip Mesh Status:",
      `  Relay: ${this.relay ? `running :${this.relay.port}` : "not started"}`,
      `  Tool Server: ${this.toolServer ? "running" : "not started"}`,
      `  Workers: ${this.workers.size} connected (${Array.from(this.workers.keys()).join(", ") || "none"})`,
      `  Orchestrator: ${this.mainAgent ? "ready" : "not initialized"}`,
      `  Pending tasks: ${pendingTasks.length}`,
      pendingTasks.length > 0 ? pendingTasks.map((t) => `    ${t.id} \u2192 ${t.agentId}: ${t.task.slice(0, 60)}...`).join("\n") : ""
    ].filter(Boolean).join("\n"));
  }
  // ── Boot infrastructure ─────────────────────────────────────────────────
  async boot() {
    const configPath = findConfigPath();
    if (!configPath) throw new Error("No gossip.agents.json found. Run gossipcat setup first.");
    const config = loadConfig(configPath);
    const agentConfigs = configToAgentConfigs(config);
    this.relay = new RelayServer({ port: 0 });
    await this.relay.start();
    this.toolServer = new ToolServer({ relayUrl: this.relay.url, projectRoot: process.cwd() });
    await this.toolServer.start();
    for (const ac of agentConfigs) {
      const key = await this.keychain.getKey(ac.provider);
      const llm = createProvider(ac.provider, ac.model, key ?? void 0);
      const worker = new WorkerAgent(ac.id, llm, this.relay.url, ALL_TOOLS);
      await worker.start();
      this.workers.set(ac.id, worker);
    }
    const mainKey = await this.keychain.getKey(config.main_agent.provider);
    this.mainAgent = new MainAgent({
      provider: config.main_agent.provider,
      model: config.main_agent.model,
      apiKey: mainKey ?? void 0,
      relayUrl: this.relay.url,
      agents: agentConfigs
    });
    await this.mainAgent.start();
    this.initialized = true;
    process.stderr.write(`[gossipcat-mcp] Booted: relay :${this.relay.port}, ${this.workers.size} workers
`);
  }
  // ── Helpers ─────────────────────────────────────────────────────────────
  text(id, text) {
    return this.respond(id, { content: [{ type: "text", text }] });
  }
  respond(id, result) {
    return { jsonrpc: "2.0", id, result };
  }
  respondError(id, code, message) {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
  async shutdown() {
    if (this.mainAgent) await this.mainAgent.stop();
    for (const w of this.workers.values()) await w.stop();
    if (this.toolServer) await this.toolServer.stop();
    if (this.relay) await this.relay.stop();
  }
};
async function main() {
  const server = new GossipMcpServer();
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) break;
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (line) handleLine(server, line);
        continue;
      }
      const header = buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/);
      if (!match) break;
      const len = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + len) break;
      const body = buffer.slice(bodyStart, bodyStart + len);
      buffer = buffer.slice(bodyStart + len);
      handleLine(server, body);
    }
  });
  const keepAlive = setInterval(() => {
  }, 6e4);
  process.stdin.on("end", async () => {
    clearInterval(keepAlive);
    await server.shutdown();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    clearInterval(keepAlive);
    await server.shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    clearInterval(keepAlive);
    await server.shutdown();
    process.exit(0);
  });
  process.stdin.resume();
}
async function handleLine(server, line) {
  try {
    const request = JSON.parse(line);
    if (request.id === void 0 || request.id === null) {
      await server.handleRequest({ ...request, id: 0 });
      return;
    }
    const response = await server.handleRequest(request);
    if (!response) return;
    const str = JSON.stringify(response);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(str)}\r
\r
${str}`);
  } catch (err) {
    process.stderr.write(`[gossipcat-mcp] Error: ${err.message}
`);
  }
}
main().catch((err) => {
  process.stderr.write(`[gossipcat-mcp] Fatal: ${err.message}
`);
  process.exit(1);
});
