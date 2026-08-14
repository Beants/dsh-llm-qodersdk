// vendor/cosmokit/src/misc.ts
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) {
    if (forced || source[key] !== void 0) result[key] = source[key];
  }
  return result;
}

// vendor/cosmokit/src/types.ts
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
((Binary2) => {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) {
      return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    } else {
      return source;
    }
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(source).toString("base64");
    }
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) {
      buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    }
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) {
      descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    }
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  if (a === b) return true;
  if (!strict && isNullable(a) && isNullable(b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (!a || !b) return false;
  function check(test, then) {
    return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
  }
  return check(Array.isArray, (a2, b2) => a2.length === b2.length && a2.every((item, index) => deepEqual(item, b2[index]))) ?? check(is("Date"), (a2, b2) => a2.valueOf() === b2.valueOf()) ?? check(is("RegExp"), (a2, b2) => a2.source === b2.source && a2.flags === b2.flags) ?? check(isArrayBufferLike, (a2, b2) => {
    if (a2.byteLength !== b2.byteLength) return false;
    const viewA = new Uint8Array(a2);
    const viewB = new Uint8Array(b2);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }) ?? Object.keys({ ...a, ...b }).every((key) => deepEqual(a[key], b[key], strict));
}

// vendor/cosmokit/src/time.ts
var Time;
((Time2) => {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) {
      date2 = Date.now() + parsed;
    } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) {
      date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) {
      date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    }
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) {
      return Math.round(ms / Time2.day) + "d";
    } else if (abs >= Time2.hour - Time2.minute / 2) {
      return Math.round(ms / Time2.hour) + "h";
    } else if (abs >= Time2.minute - Time2.second / 2) {
      return Math.round(ms / Time2.minute) + "m";
    } else if (abs >= Time2.second) {
      return Math.round(ms / Time2.second) + "s";
    }
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// vendor/schemastery/src/index.ts
var kSchema = /* @__PURE__ */ Symbol.for("schemastery");
var kValidationError = /* @__PURE__ */ Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) {
      if (typeof segment === "string") {
        prefix += "." + segment;
      } else if (typeof segment === "number") {
        prefix += "[" + segment + "]";
      } else if (typeof segment === "symbol") {
        prefix += `[Symbol(${segment.toString()})]`;
      }
    }
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  options;
  name = "ValidationError";
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, {
  value: true
});
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") {
    try {
      schema.callback = new Function("return " + schema.callback)();
    } catch {
    }
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", {
  get() {
    return {
      version: 1,
      vendor: "schemastery",
      validate: (value) => {
        try {
          return { value: Schema.resolve(value, this, {})[0] };
        } catch (error) {
          if (ValidationError.is(error)) {
            return { issues: [{ message: error.message, path: error.options.path }] };
          }
          throw error;
        }
      }
    };
  }
});
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = { uid: this.uid, refs: globalThis.__schemastery_refs__ };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) {
      result[locale] = value.$description || value.$desc;
    } else if (typeof value === "string") {
      result[locale] = value;
    }
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) {
    schema.dict = mapValues(schema.dict, (inner, key) => {
      return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
    });
  }
  if (schema.list) {
    schema.list = schema.list.map((inner, index) => {
      return inner.i18n(mapValues(messages, (data = {}) => {
        if (Array.isArray(getInner(data))) return getInner(data)[index];
        if (Array.isArray(data)) return data[index];
        return extractKeys(data);
      }));
    });
  }
  if (schema.inner) {
    schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
      if (getInner(data)) return getInner(data);
      return extractKeys(data);
    }));
  }
  if (schema.sKey) {
    schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  }
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = { ...schema.meta, [key]: value };
  return schema;
};
for (const key of ["required", "disabled", "collapse", "hidden", "loose"]) {
  Object.assign(Schema.prototype, {
    [key](value = true) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }
  });
}
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({ text: "deprecated", type: "danger" });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({ text: "experimental", type: "warning" });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = { ...schema.meta, pattern: pattern2 };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const schema = this.type === "object" ? this.dict[key] : this.inner;
      const item = schema?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) {
      Object.assign(result, item.simplify(value));
    }
    return result;
  } else if (this.type === "union") {
    for (const schema of this.list) {
      try {
        Schema.resolve(value, schema, {});
        return schema.simplify(value);
      } catch {
      }
    }
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = { ...schema.meta, role, extra: extra2 };
  return schema;
};
for (const key of ["default", "link", "comment", "description", "max", "min", "step"]) {
  Object.assign(Schema.prototype, {
    [key](value) {
      const schema = Schema(this);
      schema.meta = { ...schema.meta, [key]: value };
      return schema;
    }
  });
}
var resolvers = {};
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) {
    return Schema.any();
  } else if (["string", "number", "boolean"].includes(typeof source)) {
    return Schema.const(source).required();
  } else if (source[kSchema]) {
    return source;
  } else if (typeof source === "function") {
    switch (source) {
      case String:
        return Schema.string().required();
      case Number:
        return Schema.number().required();
      case Boolean:
        return Schema.boolean().required();
      case Function:
        return Schema.function().required();
      default:
        return Schema.is(source).required();
    }
  } else {
    throw new TypeError(`cannot infer schema from ${source}`);
  }
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({ type: "lazy", builder, inner: { toJSON: toJSON2 } });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([
    Schema.is(Date),
    Schema.transform(Schema.string().role("datetime"), (value, options) => {
      const date2 = new Date(value);
      if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
      return date2;
    }, true)
  ]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([
    Schema.is(RegExp),
    Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
      try {
        return new RegExp(value, flag);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)
  ]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = { ...schema.meta, ...schema.inner.meta };
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) {
    return (data - min) % step === 0;
  }
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) {
    throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  }
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) {
      if (data & bits[key]) {
        keys.push(key);
      }
    }
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else {
    throw new ValidationError(`expected number or array but got ${data}`, options);
  }
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) {
      throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    }
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) {
      result[key] = value;
    }
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) {
    try {
      return Schema.resolve(data, inner, options, strict);
    } catch (error) {
      messages.push(error);
    }
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) {
      result = value;
    } else if (typeof result !== typeof value) {
      throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    } else if (typeof value === "object") {
      merge(result ??= {}, value);
    } else if (result !== value) {
      throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    }
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) {
    return [callback(result)];
  } else {
    return [callback(result), callback(adapted)];
  }
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, {
    [name2](...args) {
      const schema = new Schema({ type: name2 });
      keys.forEach((key, index) => {
        switch (key) {
          case "sKey":
            schema.sKey = args[index] ?? Schema.string();
            break;
          case "inner":
            schema.inner = Schema.from(args[index]);
            break;
          case "list":
            schema.list = args[index].map(Schema.from);
            break;
          case "dict":
            schema.dict = mapValues(args[index], Schema.from);
            break;
          case "bits": {
            schema.bits = {};
            for (const key2 in args[index]) {
              if (typeof args[index][key2] !== "number") continue;
              schema.bits[key2] = args[index][key2];
            }
            break;
          }
          case "callback": {
            const callback = schema.callback = args[index];
            callback["toJSON"] ||= () => callback.toString();
            break;
          }
          case "constructor": {
            const constructor = schema.constructor = args[index];
            if (typeof constructor === "function") {
              ;
              constructor["toJSON"] ||= () => constructor["name"];
            }
            break;
          }
          default:
            schema[key] = args[index];
        }
      });
      if (name2 === "object" || name2 === "dict") {
        schema.meta.default = {};
      } else if (name2 === "array" || name2 === "tuple") {
        schema.meta.default = [];
      } else if (name2 === "bitset") {
        schema.meta.default = 0;
      }
      return schema;
    }
  });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") {
    return constructor.name;
  } else {
    return constructor;
  }
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", ["inner", "callback", "preserve"], ({ inner }, isInner) => inner.toString(isInner));
var src_default = Schema;

// packages/llm/llm/src/brand.ts
function CallId(id) {
  return id;
}

// packages/util/timeout/src/index.ts
var MAX_TIMER_DELAY_MS = 2147483647;

// packages/llm/llm/src/error.ts
var HarnessError = class extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  "i"
);
var TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  "i"
);
var EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  "i"
);

// packages/llm/llm/src/retry-policy.ts
var DEFAULT_MAX_RETRIES = 2;
var DEFAULT_INITIAL_DELAY_MS = 500;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_JITTER_RATIO = 0.1;
var DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT"
]);
var backoffSchema = src_default.object({
  initialDelayMs: src_default.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: src_default.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: src_default.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
var normalPolicySchema = src_default.object({
  mode: src_default.const("normal").required(),
  maxRetries: src_default.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: src_default.array(src_default.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema
});
var alwaysPolicySchema = src_default.object({
  mode: src_default.const("always").required(),
  backoff: backoffSchema
});
var RetryPolicySchema = src_default.union([
  normalPolicySchema,
  alwaysPolicySchema
]);

// packages/llm/llm/src/attribution.ts
import { createRequire } from "node:module";
var { version } = createRequire(import.meta.url)("../package.json");

// packages/llm/llm/src/index.ts
var LlmError = class extends HarnessError {
  /** Serializable facts retained beside this live Error. */
  failure;
  /**
   * @param message - non-empty human-readable failure summary.
   * @param code - non-empty stable provider-neutral machine code.
   * @param options - optional cause and validated serializable provider facts.
   */
  constructor(message, code, options) {
    if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
    if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
    if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) {
      throw new Error("LlmError status must be an integer from 100 through 599");
    }
    if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) {
      throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
    }
    if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) {
      throw new Error("LlmError requestId must be a non-empty string");
    }
    super(message, code, options);
    this.name = "LlmError";
    this.failure = Object.freeze({
      message,
      code,
      ...options?.status === void 0 ? {} : { status: options.status },
      ...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
      ...options?.requestId === void 0 ? {} : { requestId: options.requestId }
    });
  }
};
var LlmAdapter = class {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider) {
    return { id: provider, name: provider };
  }
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider) {
    return void 0;
  }
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider) {
    return Promise.resolve([]);
  }
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(provider, model, _signal) {
    return Promise.resolve({ provider, id: model, name: model });
  }
};

// plugins/llm-qoder/src/catalog.ts
var DEFAULT_CONTEXT_WINDOW = 2e5;
var DEFAULT_MAX_TOKENS = 32e3;
var QODER_MODELS = [
  { id: "auto", name: "Auto", description: "Qoder \u81EA\u52A8\u8DEF\u7531" },
  { id: "ultimate", name: "Ultimate", description: "\u6700\u5F3A\u6863\u4F4D\u8DEF\u7531" },
  { id: "performance", name: "Performance" },
  { id: "efficient", name: "Efficient" },
  { id: "lite", name: "Lite" },
  { id: "cmodel", name: "Cantus" },
  { id: "qmodel_38max", name: "Qwen3.8-Max" },
  { id: "qmodel_latest", name: "Qwen3.7-Max" },
  { id: "qmodel", name: "Qwen3.7-Plus" },
  { id: "kmodel_latest", name: "Kimi-K3" },
  { id: "kmodel", name: "Kimi-K2.7-Code" },
  { id: "gmodel", name: "GLM-5.3" },
  { id: "gm51model", name: "GLM-5.2" },
  { id: "dmodel", name: "DeepSeek-V4-Pro" },
  { id: "dfmodel", name: "DeepSeek-V4-Flash" },
  { id: "mmodel", name: "MiniMax-M3" }
];
var MODEL_ALIASES = {
  "deepseek-v4-flash": "dfmodel",
  "deepseek-v4-pro": "dmodel"
};
function resolveQoderModelId(model) {
  const aliased = MODEL_ALIASES[model.toLowerCase()];
  if (aliased !== void 0) return aliased;
  const stripped = model.startsWith("qoder-") ? model.slice(6) : model;
  return stripped.length > 0 ? stripped : "auto";
}

// plugins/llm-qoder/src/models.ts
import { qodercliAuth, query } from "@qoder-ai/qoder-agent-sdk";
var DEFAULT_MODEL_CACHE_TTL_MS = 5 * 6e4;
var FETCH_TIMEOUT_MS = 2e4;
var QoderModelCatalog = class {
  /** @param ttlMs - how long a fetched catalog stays fresh before a re-fetch. */
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
  }
  ttlMs;
  cached;
  inflight;
  /** Raw live entries; the stale snapshot when a refresh fails, else nothing. */
  async liveModels() {
    const cached = this.cached;
    if (cached !== void 0 && Date.now() - cached.at < this.ttlMs) return cached.models;
    this.inflight ??= this.fetch().finally(() => {
      this.inflight = void 0;
    });
    try {
      const models = await this.inflight;
      this.cached = { at: Date.now(), models };
      return models;
    } catch {
      return this.cached?.models ?? [];
    }
  }
  /** dsh catalog entries: the enabled live list, or the static fallback. */
  async models() {
    const live = (await this.liveModels()).filter((model) => model.isEnabled !== false);
    if (live.length === 0) return QODER_MODELS;
    return live.map((model) => ({
      id: model.value,
      name: model.displayName.length > 0 ? model.displayName : model.value,
      ...model.description.length > 0 ? { description: model.description } : {}
    }));
  }
  async fetch() {
    const q = query({
      prompt: inertInput(),
      options: { auth: qodercliAuth(), tools: [], allowedTools: [], settingSources: [], maxTurns: 1 }
    });
    try {
      return await withTimeout(q.getAvailableModels({ fetchStrategy: "live" }), FETCH_TIMEOUT_MS);
    } finally {
      await q.close().catch(() => void 0);
    }
  }
};
async function* inertInput() {
  await new Promise(() => {
  });
}
function withTimeout(promise, ms) {
  return new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`qoder model catalog fetch timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve2(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// plugins/llm-qoder/src/render.ts
function renderBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "reasoning":
        break;
      case "image":
        parts.push("[\u56FE\u7247\u9644\u4EF6]");
        break;
      case "tool-call":
        parts.push(`[\u8C03\u7528\u4E86\u5DE5\u5177 ${block.name}(${block.arguments})]`);
        break;
      case "tool-result": {
        parts.push(`[\u5DE5\u5177\u7ED3\u679C ${block.toolCallId}] ${renderBlocks(block.content)}`);
        break;
      }
      default:
        parts.push(JSON.stringify(block));
    }
  }
  return parts.join("\n");
}
function renderMessage(message) {
  const text = renderBlocks(message.content);
  switch (message.role) {
    case "system":
      return `[\u7CFB\u7EDF\u63D0\u793A] ${text}`;
    case "user":
      return `[\u7528\u6237] ${text}`;
    case "assistant":
      return `[\u52A9\u624B] ${text}`;
  }
}
var BACKEND_ROLE = [
  '\u4F60\u5728\u4E3A\u4E00\u4E2A\u7F16\u7801 agent\uFF08\u5BBF\u4E3B\uFF09\u5145\u5F53 LLM API \u540E\u7AEF\uFF1A\u5BBF\u4E3B\u628A\u5B83\u7684\u5BF9\u8BDD\u5582\u7ED9\u4F60\uFF0C\u4F60\u53EA\u8F93\u51FA"\u4E0B\u4E00\u6761\u52A9\u624B\u56DE\u590D"\u672C\u8EAB\u3002',
  "\u5BBF\u4E3B\u7684\u5DE5\u5177\u5DF2\u7ECF\u901A\u8FC7 MCP \u6302\u8FDB\u6765\uFF0C\u9700\u8981\u7528\u5DE5\u5177\u65F6\u76F4\u63A5\u8C03\u7528\uFF0C\u4E0D\u8981\u63CF\u8FF0\u4F60\u4F1A\u5728\u522B\u7684\u73AF\u5883\u91CC\u600E\u4E48\u8C03\u3002",
  "\u4E0D\u8981\u590D\u8FF0\u5BF9\u8BDD\uFF0C\u4E0D\u8981\u89E3\u91CA\u4F60\u7684\u89D2\u8272\u3002"
].join("\n");
function renderInitialFeed(system, messages) {
  const parts = [BACKEND_ROLE];
  if (system !== void 0 && system.length > 0) {
    parts.push(`---- \u5BBF\u4E3B\u7CFB\u7EDF\u63D0\u793A\uFF08\u4F5C\u4E3A\u4F60\u7684\u884C\u4E3A\u51C6\u5219\uFF09 ----
${system}`);
  }
  const history = messages.map(renderMessage).filter((part) => part.length > 0);
  if (history.length > 0) parts.push(`---- \u5BBF\u4E3B\u5BF9\u8BDD\u8BB0\u5F55 ----
${history.join("\n\n")}`);
  parts.push("---- \u4EE5\u4E0A\u662F\u80CC\u666F\u3002\u8F93\u51FA\u4E0B\u4E00\u6761\u52A9\u624B\u56DE\u590D\u3002 ----");
  return parts.join("\n\n");
}
function renderUserTurn(blocks) {
  return `[\u7528\u6237] ${renderBlocks(blocks)}`;
}
function renderRefreshed(message) {
  return `${renderMessage(message)}
\uFF08\u5BBF\u4E3B\u539F\u4F4D\u5237\u65B0\u4E86\u8FD9\u6761\u6D88\u606F\uFF09`;
}
function renderIdentityAppend(hostSystem) {
  const parts = [
    "\u4F60\u5F53\u524D\u4F5C\u4E3A\u4E00\u4E2A\u5BBF\u4E3B\u7F16\u7801 agent \u7684\u5185\u7F6E LLM \u540E\u7AEF\u8FD0\u884C\uFF1A\u5BF9\u5916\u8EAB\u4EFD\u4EE5\u5BBF\u4E3B\u7684\u8BBE\u5B9A\u4E3A\u51C6\u3002",
    "\u5F53\u88AB\u95EE\u53CA\u201C\u4F60\u662F\u8C01\u201D\u8FD9\u7C7B\u8EAB\u4EFD\u95EE\u9898\u65F6\uFF0C\u6309\u5BBF\u4E3B\u7CFB\u7EDF\u63D0\u793A\u4E2D\u7684\u8EAB\u4EFD\u56DE\u7B54\uFF1B\u4E0D\u8981\u81EA\u79F0 Qoder\uFF0C\u4E0D\u8981\u63D0\u53CA qodercli\u3001SDK \u6216\u4F60\u4F5C\u4E3A\u5185\u90E8\u540E\u7AEF\u7684\u4E8B\u5B9E\u3002"
  ];
  if (hostSystem !== void 0 && hostSystem.length > 0) {
    parts.push(`---- \u5BBF\u4E3B\u7CFB\u7EDF\u63D0\u793A\uFF08\u4F5C\u4E3A\u4F60\u7684\u884C\u4E3A\u51C6\u5219\u4E0E\u5BF9\u5916\u8EAB\u4EFD\uFF09 ----
${hostSystem}`);
  }
  return parts.join("\n\n");
}

// plugins/llm-qoder/src/session.ts
import { appendFileSync } from "node:fs";
import { createSdkMcpServer, qodercliAuth as qodercliAuth2, query as query2 } from "@qoder-ai/qoder-agent-sdk";

// plugins/llm-qoder/src/jsonschema.ts
import { z } from "zod";
function jsonSchemaToZod(schema, depth = 0) {
  if (schema === void 0 || depth > 6) return z.unknown();
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v) => typeof v === "string");
    if (values.length === schema.enum.length && values.length > 0) return z.enum(values);
    return z.unknown();
  }
  const type = schema.type;
  const description = typeof schema.description === "string" ? schema.description : void 0;
  let base;
  switch (type) {
    case "string":
      base = z.string();
      break;
    case "number":
      base = z.number();
      break;
    case "integer":
      base = z.number().int();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array": {
      const items = schema.items;
      base = z.array(
        jsonSchemaToZod(typeof items === "object" && items !== null && !Array.isArray(items) ? items : void 0, depth + 1)
      );
      break;
    }
    case "object": {
      const properties = schema.properties;
      const required = Array.isArray(schema.required) ? schema.required.filter((v) => typeof v === "string") : [];
      const shape = {};
      if (typeof properties === "object" && properties !== null) {
        for (const [key, node] of Object.entries(properties)) {
          const nodeSchema = typeof node === "object" && node !== null && !Array.isArray(node) ? node : void 0;
          shape[key] = required.includes(key) ? jsonSchemaToZod(nodeSchema, depth + 1) : jsonSchemaToZod(nodeSchema, depth + 1).optional();
        }
      }
      base = z.object(shape);
      break;
    }
    default:
      base = z.unknown();
  }
  return description === void 0 ? base : base.describe(description);
}
function jsonSchemaToShape(parameters) {
  const properties = parameters.properties;
  if (typeof properties !== "object" || properties === null) return {};
  const shape = {};
  const required = Array.isArray(parameters.required) ? parameters.required.filter((v) => typeof v === "string") : [];
  for (const [key, node] of Object.entries(properties)) {
    const nodeSchema = typeof node === "object" && node !== null && !Array.isArray(node) ? node : void 0;
    shape[key] = required.includes(key) ? jsonSchemaToZod(nodeSchema, 1) : jsonSchemaToZod(nodeSchema, 1).optional();
  }
  return shape;
}

// plugins/llm-qoder/src/session.ts
function dbg(message) {
  try {
    appendFileSync("/tmp/qoder-probe/adapter.log", `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`);
  } catch {
  }
}
var MCP_SERVER_NAME = "dsh-host";
var MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
function createChannel() {
  const queue = [];
  let resolve2 = null;
  return {
    push(message) {
      if (resolve2 !== null) {
        const settle = resolve2;
        resolve2 = null;
        settle({ value: message, done: false });
      } else {
        queue.push(message);
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          const message = queue.shift();
          if (message !== void 0) return Promise.resolve({ value: message, done: false });
          return new Promise((settle) => {
            resolve2 = settle;
          });
        }
      };
    }
  };
}
var TurnQueue = class {
  items = [];
  resolve = null;
  closed = false;
  push(item) {
    if (this.closed) return;
    if (this.resolve !== null) {
      const settle = this.resolve;
      this.resolve = null;
      settle({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }
  close() {
    this.closed = true;
    if (this.resolve !== null) {
      const settle = this.resolve;
      this.resolve = null;
      settle({ value: void 0, done: true });
    }
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== void 0) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: void 0, done: true });
        return new Promise((settle) => {
          this.resolve = settle;
        });
      }
    };
  }
};
function hostToolName(name2) {
  return name2.startsWith(MCP_TOOL_PREFIX) ? name2.slice(MCP_TOOL_PREFIX.length) : name2;
}
async function gateTools(toolName, _input, options) {
  const echo = options.toolUseID !== void 0 ? { toolUseID: options.toolUseID } : {};
  if (toolName.startsWith(MCP_TOOL_PREFIX)) return { behavior: "allow", ...echo };
  return {
    behavior: "deny",
    message: "\u672C\u4F1A\u8BDD\u662F\u5BBF\u4E3B agent \u7684 LLM \u540E\u7AEF\uFF0C\u4E0D\u76F4\u63A5\u6267\u884C\u5DE5\u5177\u3002\u5BBF\u4E3B\u7684\u5DE5\u5177\u5DF2\u901A\u8FC7 MCP \u6302\u5165\uFF0C\u76F4\u63A5\u8C03\u7528\u5B83\u4EEC\u5373\u53EF\u3002",
    ...echo
  };
}
var QoderSession = class {
  constructor(sessionId, initialModel) {
    this.sessionId = sessionId;
    this.model = initialModel;
  }
  sessionId;
  channel = createChannel();
  /**
   * Lazy: the MCP SDK refuses tool registration after the transport connects,
   * so the inner process only spawns once {@link ensureTools} has registered
   * the host tools (the adapter does that immediately before each stream).
   */
  q = null;
  /**
   * Tool-call pairing state. qodercli executes calls one at a time and only
   * invokes the NEXT handler after the previous MCP round trip completes,
   * while the host delivers ALL results of a turn up front on the next
   * request — so results buffer by callId and handlers claim their callId
   * from the emission-order queue when they fire.
   */
  parked = /* @__PURE__ */ new Map();
  pendingResults = /* @__PURE__ */ new Map();
  openCalls = [];
  mcp = createSdkMcpServer({ name: MCP_SERVER_NAME, tools: [] });
  registered = /* @__PURE__ */ new Map();
  queue = null;
  model;
  callCounter = 0;
  abortPending = false;
  disposed = false;
  /** Previous request's messages for delta feeding. */
  fedMessages;
  fedSystem;
  fedChars = 0;
  /** Host system prompt captured before spawn for the boot-time systemPrompt. */
  hostSystem;
  // Active-turn assembly state, touched only by the consumer fiber.
  blockIndex = 0;
  textBlock;
  reasoningBlock;
  openTool;
  toolCalls = [];
  outputChars = 0;
  reasoningChars = 0;
  /** Spawn the inner process (first stream only) and attach the consumer. */
  ensureStarted() {
    if (this.q !== null) return this.q;
    const q = query2({
      prompt: this.channel,
      options: {
        auth: qodercliAuth2(),
        tools: [],
        allowedTools: [],
        canUseTool: gateTools,
        settingSources: [],
        includePartialMessages: true,
        resolveModel: () => ({ model: this.model }),
        mcpServers: { [MCP_SERVER_NAME]: this.mcp },
        allowedMcpServerNames: [MCP_SERVER_NAME],
        systemPrompt: { type: "preset", preset: "qodercli", append: renderIdentityAppend(this.hostSystem) }
      }
    });
    this.q = q;
    void this.consume(q);
    return q;
  }
  /** Point the session at a model for the next turn (SDK re-resolves per request). */
  setModel(model) {
    this.model = model;
  }
  /** Record the host system prompt; effective only before the process spawns. */
  setSystem(system) {
    this.hostSystem = system;
  }
  /** Register any host tools not yet known to this session's MCP server. */
  ensureTools(tools) {
    dbg(`ensureTools session=${this.sessionId} count=${tools.length} started=${this.q !== null}`);
    for (const schema of tools) {
      const hash = JSON.stringify(schema.parameters ?? {});
      if (this.registered.has(schema.name)) continue;
      const shape = jsonSchemaToShape(schema.parameters ?? {});
      try {
        this.mcp.instance.registerTool(schema.name, {
          description: schema.description.length > 0 ? schema.description : schema.name,
          inputSchema: shape
        }, async (args) => {
          void args;
          const callId = this.openCalls.shift();
          dbg(`mcp handler INVOKED name=${schema.name} callId=${String(callId)} buffered=${callId !== void 0 && this.pendingResults.has(callId)}`);
          let result;
          if (callId !== void 0 && this.pendingResults.has(callId)) {
            result = this.pendingResults.get(callId);
            this.pendingResults.delete(callId);
          } else {
            const key = callId ?? `anon-${this.callCounter}-${this.parked.size}`;
            result = await new Promise((resolve2) => {
              this.parked.set(key, resolve2);
            });
          }
          dbg(`mcp handler RESOLVED name=${schema.name} callId=${String(callId)} isError=${result.isError} chars=${result.text.length}`);
          return {
            content: [{ type: "text", text: result.text }],
            ...result.isError ? { isError: true } : {}
          };
        });
      } catch (error) {
        dbg(`ensureTools REGISTER FAILED name=${schema.name} error=${String(error)}`);
        continue;
      }
      dbg(`ensureTools registered name=${schema.name}`);
      this.registered.set(schema.name, hash);
    }
  }
  /** Deliver host tool results to parked/buffered handlers, keyed by callId. */
  deliverToolResults(tail) {
    dbg(`deliverToolResults tail=${tail.length} parked=${this.parked.size} roles=${tail.map((m) => `${m.role}:${m.source.kind}`).join(",")}`);
    let freshUserTurn = false;
    for (const message of tail) {
      if (message.role === "user" && message.source.kind !== "tool") {
        freshUserTurn = true;
        continue;
      }
      if (message.role !== "user" || message.source.kind !== "tool") continue;
      const block = message.content[0];
      if (block === void 0 || block.type !== "tool-result") continue;
      const callId = String(block.toolCallId);
      const payload = { text: renderResultText(block.content), isError: block.isError === true };
      const resolve2 = this.parked.get(callId);
      if (resolve2 !== void 0) {
        this.parked.delete(callId);
        resolve2(payload);
      } else {
        this.pendingResults.set(callId, payload);
      }
      dbg(`deliverToolResults ${callId} -> ${resolve2 !== void 0 ? "parked" : "buffered"} isError=${payload.isError} chars=${payload.text.length}`);
    }
    if (freshUserTurn && this.parked.size > 0) {
      const stale = [...this.parked.entries()];
      this.parked.clear();
      for (const [, resolve2] of stale) resolve2({ text: "[\u5BBF\u4E3B\u53D6\u6D88\u4E86\u8FD9\u6B21\u5DE5\u5177\u6267\u884C]", isError: true });
    }
  }
  /** Run one inner turn: feed (if any) then pump consumer chunks until finish. */
  async *stream(options, feed) {
    if (this.queue !== null) throw new LlmError(`qoder session ${this.sessionId} already has a turn in flight`, "CONFLICT");
    if (this.disposed) throw new LlmError(`qoder session ${this.sessionId} was disposed`, "TRANSPORT");
    const q = this.ensureStarted();
    this.queue = new TurnQueue();
    this.resetTurnState();
    if (feed !== null) {
      this.fedChars += feed.length;
      this.channel.push({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: feed }] },
        parent_tool_use_id: null
      });
    }
    const signal = options.signal;
    const onAbort = () => {
      this.abortPending = true;
      void q.interrupt();
      setTimeout(() => this.endTurn({ kind: "aborted", failure: { message: "qoder session aborted by host", code: "ABORTED" } }), 5e3);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const item of this.queue) {
        if (item.kind === "chunk") {
          yield item.chunk;
          continue;
        }
        if (item.usage !== void 0) yield { type: "usage", usage: item.usage };
        yield { type: "finish", reason: item.reason };
        return;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.queue = null;
      this.abortPending = false;
    }
  }
  /** Tear the inner process down; parked calls die with it. */
  close() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.q !== null) void this.q.close().catch(() => void 0);
  }
  resetTurnState() {
    this.blockIndex = 0;
    this.textBlock = void 0;
    this.reasoningBlock = void 0;
    this.openTool = void 0;
    this.toolCalls = [];
    this.outputChars = 0;
    this.reasoningChars = 0;
  }
  emit(chunk) {
    this.queue?.push({ kind: "chunk", chunk });
  }
  usage() {
    return {
      inputTokens: Math.max(1, Math.ceil(this.fedChars / 4)),
      outputTokens: Math.max(1, Math.ceil((this.outputChars + this.reasoningChars) / 4)),
      ...this.reasoningChars > 0 ? { reasoningTokens: Math.ceil(this.reasoningChars / 4) } : {}
    };
  }
  endTurn(reason, usage) {
    if (this.queue === null) return;
    if (this.textBlock !== void 0) {
      this.emit({ type: "block-end", index: this.textBlock.index, block: { type: "text", text: this.textBlock.text } });
    }
    if (this.reasoningBlock !== void 0) {
      this.emit({ type: "block-end", index: this.reasoningBlock.index, block: { type: "reasoning", text: this.reasoningBlock.text } });
    }
    this.queue.push({ kind: "turn-end", reason, usage: usage ?? this.usage() });
    this.queue.close();
  }
  async consume(q) {
    try {
      const iterator = q[Symbol.asyncIterator]();
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        try {
          this.handle(next.value);
        } catch (error) {
          this.endTurn({ kind: "error", failure: { message: `qoder session consumer failed: ${String(error)}`, code: "BACKEND_ERROR" } });
        }
      }
      this.endTurn({ kind: "error", failure: { message: "qoder session stream ended unexpectedly", code: "STREAM_CLOSED" } });
    } catch (error) {
      this.endTurn({ kind: "error", failure: { message: `qoder session died: ${String(error)}`, code: "TRANSPORT" } });
    }
  }
  handle(message) {
    if (message.type === "stream_event") {
      const event = message.event;
      if (event === void 0) return;
      switch (event.type) {
        case "content_block_start": {
          const block = event.content_block;
          if (block?.type === "tool_use") {
            dbg(`tool_use from inner model name=${block.name ?? ""}`);
            const callId = `qoder-${++this.callCounter}`;
            this.openCalls.push(callId);
            const chunkIndex = this.blockIndex++;
            this.openTool = {
              chunkIndex,
              callId,
              name: hostToolName(block.name ?? ""),
              arguments: block.input !== void 0 && block.input !== null && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : ""
            };
            this.emit({ type: "block-start", index: chunkIndex, blockType: "tool-call" });
            this.emit({
              type: "tool-call-delta",
              index: chunkIndex,
              id: CallId(callId),
              name: this.openTool.name,
              argumentsDelta: ""
            });
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta === void 0) return;
          if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
            if (this.textBlock === void 0) {
              this.textBlock = { index: this.blockIndex++, text: "" };
              this.emit({ type: "block-start", index: this.textBlock.index, blockType: "text" });
            }
            this.textBlock.text += delta.text;
            this.outputChars += delta.text.length;
            this.emit({ type: "text-delta", index: this.textBlock.index, text: delta.text });
          } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
            if (this.reasoningBlock === void 0) {
              this.reasoningBlock = { index: this.blockIndex++, text: "" };
              this.emit({ type: "block-start", index: this.reasoningBlock.index, blockType: "reasoning" });
            }
            this.reasoningBlock.text += delta.thinking;
            this.reasoningChars += delta.thinking.length;
            this.emit({ type: "reasoning-delta", index: this.reasoningBlock.index, text: delta.thinking });
          } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && this.openTool !== void 0) {
            this.openTool.arguments += delta.partial_json;
            this.emit({
              type: "tool-call-delta",
              index: this.openTool.chunkIndex,
              id: CallId(this.openTool.callId),
              argumentsDelta: delta.partial_json
            });
          }
          break;
        }
        case "content_block_stop": {
          if (this.openTool !== void 0) {
            this.emit({
              type: "block-end",
              index: this.openTool.chunkIndex,
              block: {
                type: "tool-call",
                id: CallId(this.openTool.callId),
                name: this.openTool.name,
                arguments: this.openTool.arguments
              }
            });
            this.toolCalls.push(this.openTool);
            this.openTool = void 0;
          }
          break;
        }
        case "message_stop": {
          if (this.toolCalls.length > 0) this.endTurn({ kind: "tool-calls" });
          break;
        }
        default:
          break;
      }
      return;
    }
    if (message.type === "assistant") {
      if (this.textBlock === void 0 && this.toolCalls.length === 0) {
        const text = (message.message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
        if (text.length > 0) {
          this.textBlock = { index: this.blockIndex++, text };
          this.outputChars += text.length;
          this.emit({ type: "block-start", index: this.textBlock.index, blockType: "text" });
          this.emit({ type: "text-delta", index: this.textBlock.index, text });
        }
      }
      return;
    }
    if (message.type === "result") {
      if (this.abortPending) {
        this.endTurn({ kind: "aborted", failure: { message: "qoder turn aborted by host", code: "ABORTED" } });
        return;
      }
      if (this.toolCalls.length > 0) {
        this.endTurn({ kind: "tool-calls" });
        return;
      }
      if (message.subtype === "success" || message.subtype === void 0) {
        if (this.textBlock === void 0 && this.reasoningBlock === void 0) {
          this.endTurn({
            kind: "error",
            failure: { message: "qoder model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
          });
        } else {
          this.endTurn({ kind: "stop" });
        }
        return;
      }
      this.endTurn({
        kind: "error",
        failure: { message: `qoder turn failed: ${message.subtype} ${safeErrors(message.errors)}`, code: "BACKEND_TURN_ERROR" }
      });
    }
  }
};
function renderResultText(blocks) {
  const parts = [];
  for (const block of blocks) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "image") parts.push("[\u56FE\u7247\u7ED3\u679C]");
    else parts.push(JSON.stringify(block));
  }
  return parts.join("\n");
}
function safeErrors(errors) {
  if (errors === void 0) return "";
  if (typeof errors === "string") return errors;
  try {
    return JSON.stringify(errors);
  } catch {
    return String(errors);
  }
}
var QoderSessionManager = class {
  constructor(maxSessions = 8) {
    this.maxSessions = maxSessions;
  }
  maxSessions;
  sessions = /* @__PURE__ */ new Map();
  /** Existing or fresh warm session for one host session id. */
  forSession(sessionId, model) {
    const existing = this.sessions.get(sessionId);
    if (existing !== void 0) {
      this.sessions.delete(sessionId);
      this.sessions.set(sessionId, existing);
      return existing;
    }
    const session = new QoderSession(sessionId, model);
    this.sessions.set(sessionId, session);
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next();
      if (oldest.done === true) break;
      const victim = this.sessions.get(oldest.value);
      this.sessions.delete(oldest.value);
      victim?.close();
    }
    return session;
  }
  /** Drop one session (history diverged); the next request rebuilds it cold. */
  dispose(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session === void 0) return;
    this.sessions.delete(sessionId);
    session.close();
  }
  closeAll() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
  /** One-shot turn with no warm state: side channels and cold rebuilds. */
  async *coldStream(options, prompt, model) {
    const q = query2({
      prompt,
      options: {
        auth: qodercliAuth2(),
        tools: [],
        allowedTools: [],
        canUseTool: gateTools,
        settingSources: [],
        maxTurns: 4,
        model
      }
    });
    const signal = options.signal;
    const onAbort = () => {
      void q.interrupt();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      let text = "";
      let failure;
      for await (const message of q) {
        const msg = message;
        if (msg.type === "assistant") {
          const chunk = (msg.message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
          if (chunk.length > 0) text += chunk;
        } else if (msg.type === "result" && msg.subtype !== "success" && msg.subtype !== void 0) {
          failure = { message: `qoder side-channel turn failed: ${msg.subtype} ${safeErrors(msg.errors)}`, code: "BACKEND_TURN_ERROR" };
        }
      }
      if (signal?.aborted === true) {
        yield { type: "finish", reason: { kind: "aborted", failure: { message: "aborted by host", code: "ABORTED" } } };
        return;
      }
      if (failure !== void 0 && text.length === 0) {
        yield { type: "finish", reason: { kind: "error", failure } };
        return;
      }
      if (text.length === 0) {
        yield {
          type: "finish",
          reason: { kind: "error", failure: { message: "qoder side-channel returned no content", code: EMPTY_RESPONSE_CODE } }
        };
        return;
      }
      yield { type: "block-start", index: 0, blockType: "text" };
      for (let i = 0; i < text.length; i += 192) {
        yield { type: "text-delta", index: 0, text: text.slice(i, i + 192) };
      }
      yield { type: "block-end", index: 0, block: { type: "text", text } };
      yield {
        type: "usage",
        usage: {
          inputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
          outputTokens: Math.max(1, Math.ceil(text.length / 4))
        }
      };
      yield { type: "finish", reason: { kind: "stop" } };
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await q.close().catch(() => void 0);
    }
  }
};

// plugins/llm-qoder/src/adapter.ts
import { appendFileSync as appendFileSync2 } from "node:fs";
function dbg2(message) {
  try {
    appendFileSync2("/tmp/qoder-probe/adapter.log", `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`);
  } catch {
  }
}
var QODER_PROVIDER = "qoder";
function modelInfo(provider, entry) {
  return {
    provider,
    id: entry.id,
    name: entry.name,
    ...entry.description === void 0 ? {} : { description: entry.description },
    inputModalities: ["text"]
  };
}
var QoderAdapter = class extends LlmAdapter {
  sessions;
  catalog;
  constructor(options = {}) {
    super();
    this.sessions = new QoderSessionManager(options.maxSessions ?? 8);
    this.catalog = new QoderModelCatalog(options.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS);
  }
  providerInfo(provider) {
    return { id: provider, name: "Qoder CLI" };
  }
  async listModels(provider) {
    return (await this.catalog.models()).map((entry) => modelInfo(provider, entry));
  }
  async resolveModel(provider, model, _signal) {
    const live = (await this.catalog.liveModels()).find((entry) => entry.value === model);
    if (live !== void 0) {
      return {
        provider,
        id: live.value,
        name: live.displayName.length > 0 ? live.displayName : live.value,
        ...live.description.length > 0 ? { description: live.description } : {},
        inputModalities: ["text"],
        context: { contextWindow: live.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW },
        defaultMaxTokens: live.maxOutputTokens ?? DEFAULT_MAX_TOKENS
      };
    }
    const configured = QODER_MODELS.find((entry) => entry.id === model);
    return Promise.resolve({
      ...configured === void 0 ? { provider, id: model, name: model, inputModalities: ["text"] } : modelInfo(provider, configured),
      context: { contextWindow: DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: DEFAULT_MAX_TOKENS
    });
  }
  async *stream(options) {
    dbg2(`stream provider=${options.provider} model=${options.model} session=${String(options.sessionId ?? "<none>")} purpose=${String(options.purpose ?? "<none>")} tools=${options.tools?.length ?? 0} messages=${options.messages.length}`);
    const model = resolveQoderModelId(options.model);
    if (options.sessionId === void 0 || options.purpose !== void 0) {
      const prompt = renderInitialFeed(options.system, options.messages) + "\n\uFF08\u8FD9\u662F\u4E00\u6B21\u6027\u65C1\u8DEF\u8BF7\u6C42\uFF0C\u76F4\u63A5\u8F93\u51FA\u4E0B\u4E00\u6761\u52A9\u624B\u56DE\u590D\u3002\uFF09";
      yield* this.sessions.coldStream(options, prompt, model);
      return;
    }
    const sessionId = String(options.sessionId);
    let session = this.sessions.forSession(sessionId, model);
    if (session.fedMessages === void 0) {
      yield* this.firstTurn(session, options, model);
      return;
    }
    session.deliverToolResults(options.messages.slice(session.fedMessages.length));
    const plan = planContinuation(session.fedMessages, options.messages);
    if (plan.rebuild) {
      this.sessions.dispose(sessionId);
      session = this.sessions.forSession(sessionId, model);
      yield* this.firstTurn(session, options, model);
      return;
    }
    session.setModel(model);
    session.ensureTools(options.tools ?? []);
    session.fedMessages = options.messages;
    session.fedSystem = options.system;
    yield* session.stream(options, plan.feed);
  }
  async *firstTurn(session, options, model) {
    session.setModel(model);
    session.setSystem(options.system);
    session.ensureTools(options.tools ?? []);
    session.fedMessages = options.messages;
    session.fedSystem = options.system;
    yield* session.stream(options, renderInitialFeed(options.system, options.messages));
  }
  /** Tear down every warm inner session (plugin dispose). */
  close() {
    this.sessions.closeAll();
  }
};
function planContinuation(previous, current) {
  if (current.length <= previous.length) return { feed: null, rebuild: true };
  const mutated = [];
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) mutated.push(i);
  }
  if (mutated.includes(0) || mutated.length > 2) return { feed: null, rebuild: true };
  const tail = current.slice(previous.length);
  const freshUser = tail.filter((m) => m.role === "user" && m.source.kind !== "tool");
  if (freshUser.length === 0 && mutated.length === 0) return { feed: null, rebuild: false };
  const parts = [];
  for (const index of mutated) {
    const message = current[index];
    if (message !== void 0) parts.push(renderRefreshed(message));
  }
  for (const message of freshUser) parts.push(renderUserTurn(message.content));
  return { feed: parts.join("\n\n"), rebuild: false };
}

// plugins/llm-qoder/src/index.ts
var name = "llm-qoder";
var inject = ["llm"];
var Config = src_default.object({
  maxSessions: src_default.number().step(1).min(1).max(64).default(8),
  modelCacheTtlSeconds: src_default.number().step(1).min(10).max(86400).default(300)
});
function apply(ctx, config) {
  const adapter = new QoderAdapter({
    maxSessions: config.maxSessions ?? 8,
    modelCacheTtlMs: (config.modelCacheTtlSeconds ?? 300) * 1e3
  });
  ctx.llm.registerAdapter([QODER_PROVIDER], adapter);
}
export {
  Config,
  QODER_MODELS,
  QODER_PROVIDER,
  QoderAdapter,
  QoderModelCatalog,
  QoderSession,
  QoderSessionManager,
  apply,
  inject,
  name,
  resolveQoderModelId
};
