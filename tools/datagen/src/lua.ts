import { LuaFactory, type LuaEngine } from 'wasmoon';

/**
 * Lua runtime for reading OTServer data files.
 *
 * The server's data is Lua source, not a data format, so we execute it rather
 * than pattern-match it. Files use string continuations (`\z`), conditionals,
 * comments and several hundred engine constants; a regex parser gets ~95% right
 * and fails silently on the rest.
 *
 * Two tricks make this work without stubbing the whole engine API:
 *
 * 1. `_G` gets an `__index` metamethod returning the key name. Any undefined
 *    global (`COMBAT_FIREDAMAGE`, `BESTY_RACE_MAMMAL`, `CONST_ME_MORTAREA`, ...)
 *    evaluates to its own name as a string, so we capture the symbol without
 *    enumerating hundreds of enums.
 * 2. Results are serialised to JSON inside Lua. Going through wasmoon's
 *    automatic table conversion loses the array/object distinction, which
 *    matters for loot lists and attack lists.
 */

const PRELUDE = /* lua */ `
-- Unknown globals resolve to a "symbol": a cached object that carries its own
-- name, can be called, indexed and compared. Data files use these both as enum
-- values (\`type = COMBAT_FIREDAMAGE\`) and as helper calls
-- (\`RegisterPrimalPackBeast(mType)\`, \`Position(x, y, z)\`), so a plain string
-- is not enough - calling a string raises an error.
local symbols = {}
local symbolMeta

-- Arithmetic on a symbol means the file is computing with a config value we
-- did not define (e.g. \`interval = config.waveInterval * 1000\`). Treating the
-- symbol as zero keeps the file running; the declarative fields we care about
-- are unaffected.
local function arith(a, b)
  local an = type(a) == 'number' and a or 0
  local bn = type(b) == 'number' and b or 0
  return an + bn - an - bn
end

symbolMeta = {
  __call = function(self) return self end,
  __index = function(self) return self end,
  __tostring = function(self) return rawget(self, '__symbol') end,
  __concat = function(a, b) return tostring(a) .. tostring(b) end,
  __eq = function(a, b) return rawget(a, '__symbol') == rawget(b, '__symbol') end,
  __len = function() return 0 end,
  __lt = function() return false end,
  __le = function() return false end,
  __unm = function() return 0 end,
  __add = arith, __sub = arith, __mul = arith,
  __div = arith, __mod = arith, __pow = arith,
}

local function symbol(name)
  local existing = symbols[name]
  if existing then return existing end
  local created = setmetatable({ __symbol = name }, symbolMeta)
  symbols[name] = created
  return created
end

setmetatable(_G, {
  __index = function(_, key) return symbol(key) end
})

-- Data files pull in shared boss mechanics from paths that only exist inside
-- the running server. We only want the declarative tables, so loading is a
-- no-op.
dofile = function() return true end
loadfile = function() return function() end end
require = function(name) return symbol(name) end

-- JSON encoder. A Lua table is emitted as an array when its keys are exactly
-- 1..n, otherwise as an object.
local function isArray(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' or k % 1 ~= 0 or k < 1 then return false, 0 end
    if k > n then n = k end
  end
  for i = 1, n do
    if t[i] == nil then return false, 0 end
  end
  return true, n
end

local escapes = {
  ['"'] = '\\\\"', ['\\\\'] = '\\\\\\\\', ['\\n'] = '\\\\n',
  ['\\r'] = '\\\\r', ['\\t'] = '\\\\t', ['\\b'] = '\\\\b', ['\\f'] = '\\\\f',
}

local function encodeString(s)
  return '"' .. s:gsub('[%c"\\\\]', function(c)
    return escapes[c] or string.format('\\\\u%04x', c:byte())
  end) .. '"'
end

local encode

local function encodeValue(v, seen)
  local t = type(v)
  if v == nil then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if v % 1 == 0 then return string.format('%d', v) end
    return tostring(v)
  end
  if t == 'string' then return encodeString(v) end
  if t == 'table' then
    -- Symbols encode as their name, so enum values survive as strings.
    local name = rawget(v, '__symbol')
    if name then return encodeString(name) end
    return encode(v, seen)
  end
  -- functions, userdata: not data, drop them
  return 'null'
end

encode = function(t, seen)
  seen = seen or {}
  if seen[t] then return 'null' end
  seen[t] = true
  local arr, n = isArray(t)
  local parts = {}
  if arr then
    for i = 1, n do parts[#parts + 1] = encodeValue(t[i], seen) end
    seen[t] = nil
    return '[' .. table.concat(parts, ',') .. ']'
  end
  local keys = {}
  for k in pairs(t) do
    if type(k) == 'string' or type(k) == 'number' then keys[#keys + 1] = k end
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  for _, k in ipairs(keys) do
    local v = t[k]
    if type(v) ~= 'function' and type(v) ~= 'userdata' then
      parts[#parts + 1] = encodeString(tostring(k)) .. ':' .. encodeValue(v, seen)
    end
  end
  seen[t] = nil
  return '{' .. table.concat(parts, ',') .. '}'
end

__encodeJson = encode
`;

export interface LuaSandbox {
  /** Run a chunk. Returns an error message on failure, null on success. */
  run(source: string, chunkName: string): string | null;
  /** JSON-encode a global table and parse it. */
  read<T>(globalName: string): T;
  close(): void;
}

export async function createSandbox(extraPrelude = ''): Promise<LuaSandbox> {
  const factory = new LuaFactory();
  const lua: LuaEngine = await factory.createEngine({ injectObjects: false });
  lua.doStringSync(PRELUDE);
  if (extraPrelude) lua.doStringSync(extraPrelude);

  return {
    run(source, chunkName) {
      try {
        lua.doStringSync(source);
        return null;
      } catch (error) {
        return `${chunkName}: ${(error as Error).message}`;
      }
    },
    read<T>(globalName: string): T {
      const json = lua.doStringSync(`return __encodeJson(${globalName})`) as string;
      return JSON.parse(json) as T;
    },
    close() {
      lua.global.close();
    },
  };
}
