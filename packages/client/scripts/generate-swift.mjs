#!/usr/bin/env node
// Generates swift/CeliadorAPI.swift from openapi.yaml: plain Codable, Sendable,
// Equatable Swift types for `components.schemas` (no client, no paths), with no
// dependency beyond the Swift standard library, so the file can compile into
// the iOS app, its widgets and the Live Activity alike.
//
//   node scripts/generate-swift.mjs           write swift/CeliadorAPI.swift
//   node scripts/generate-swift.mjs --check   fail when the committed file differs
//
// Mapping (see README.md, "Swift"):
//   object                  → struct (camelCase properties, CodingKeys for other JSON names);
//                             optional when not required or nullable
//   object + additionalProperties: true + properties
//                           → struct that also keeps unknown keys in `additionalProperties`
//   object without properties → [String: T] (T = JSONValue when free-form)
//   allOf                   → one flattened struct
//   string enum             → RawRepresentable struct: unknown values decode (additive API)
//   oneOf, discriminated by `kind`
//                           → enum with associated values + `.unknown(kind:payload:)`
//   other oneOf             → enum; decoding tries each variant in order
//   {} (any)                → JSONValue
//   integer/number/boolean/string → Int/Double/Bool/String (date-time stays String)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "openapi.yaml");
const outPath = join(root, "swift", "CeliadorAPI.swift");
const NS = "CeliadorAPI";

const spec = parse(readFileSync(specPath, "utf8"));
const schemas = spec.components?.schemas ?? {};

// ---------------------------------------------------------------- names

const KEYWORDS = new Set([
  "associatedtype", "class", "deinit", "enum", "extension", "fileprivate", "func", "import",
  "init", "inout", "internal", "let", "open", "operator", "private", "precedencegroup",
  "protocol", "public", "rethrows", "static", "struct", "subscript", "typealias", "var",
  "break", "case", "catch", "continue", "default", "defer", "do", "else", "fallthrough",
  "for", "guard", "if", "in", "repeat", "return", "throw", "switch", "where", "while",
  "as", "false", "is", "nil", "self", "Self", "super", "throws", "true", "try", "Any",
]);
// Names a nested type can't take, and names that would shadow what the generated code uses.
const RESERVED_TYPES = new Set(["Type", "Protocol", "Self", "Any"]);
const SHADOWING = new Set([
  "String", "Int", "Double", "Bool", "Decoder", "Encoder", "CodingKey", "CodingKeys",
  "DecodingError", "Codable", "Sendable", "Equatable", "Hashable", "RawRepresentable",
  "JSONValue", "AnyCodingKey",
]);

function camel(name) {
  const parts = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) throw new Error(`can't name ${JSON.stringify(name)}`);
  let out = parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
  for (const p of parts.slice(1)) out += p.charAt(0).toUpperCase() + p.slice(1);
  return /^[0-9]/.test(out) ? `_${out}` : out;
}
function pascal(name) {
  const c = camel(name);
  const out = c.charAt(0).toUpperCase() + c.slice(1);
  return RESERVED_TYPES.has(out) ? `${out}Value` : out;
}
const ident = (name) => (KEYWORDS.has(name) ? `\`${name}\`` : name);
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const str = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const refName = (ref) => {
  const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (!m) throw new Error(`unsupported $ref ${ref}`);
  if (!schemas[m[1]]) throw new Error(`dangling $ref ${ref}`);
  return m[1];
};
const topName = (name) => {
  const n = pascal(name);
  if (SHADOWING.has(n)) throw new Error(`schema ${name} would shadow a type the generated code uses`);
  return n;
};
const qualified = (name) => `${NS}.${topName(name)}`;

const doc = (text) =>
  text ? String(text).trim().split("\n").map((l) => (l.trim() ? `/// ${l.trimEnd()}` : "///")) : [];
const indent = (lines) => lines.map((l) => (l ? `    ${l}` : l));

// ---------------------------------------------------------------- schema helpers

function typesOf(schema) {
  const t = schema.type;
  if (t === undefined) return { types: [], nullable: false };
  const list = Array.isArray(t) ? t : [t];
  return { types: list.filter((x) => x !== "null"), nullable: list.includes("null") };
}

// Flattens an object schema (following $ref and allOf) into its properties. Each
// property remembers the type that owns the nested types its inline schema needs:
// the referenced component when it came through a $ref, else `owner`.
function flatten(schema, owner) {
  if (schema.$ref) {
    const name = refName(schema.$ref);
    return flatten(schemas[name], qualified(name));
  }
  const out = { props: new Map(), required: new Set(), additional: false };
  const merge = (other) => {
    for (const [k, v] of other.props) out.props.set(k, v);
    for (const r of other.required) out.required.add(r);
    if (other.additional) out.additional = other.additional;
  };
  for (const part of schema.allOf ?? []) merge(flatten(part, owner));
  for (const [k, v] of Object.entries(schema.properties ?? {})) out.props.set(k, { schema: v, owner });
  for (const r of schema.required ?? []) out.required.add(r);
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    out.additional = schema.additionalProperties;
  }
  return out;
}

const isObjectLike = (s) =>
  Boolean(s.allOf) || typesOf(s).types.includes("object") || (s.properties && !s.type);

// The `kind` values a schema can carry, or null when it isn't kind-discriminated.
function kindValues(schema) {
  if (schema.$ref) return kindValues(schemas[refName(schema.$ref)]);
  if (schema.oneOf) {
    if (schema.discriminator) {
      if (schema.discriminator.propertyName !== "kind") return null;
      return Object.keys(schema.discriminator.mapping ?? {});
    }
    const all = schema.oneOf.map(kindValues);
    return all.every(Boolean) ? all.flat() : null;
  }
  if (!isObjectLike(schema)) return null;
  const kind = flatten(schema, "").props.get("kind");
  return kind && kind.schema.const !== undefined ? [String(kind.schema.const)] : null;
}

// ---------------------------------------------------------------- types

// The Swift type for `schema` used at `owner`. Inline types that need a declaration
// are appended to `nested` (declared inside `owner`) under `suggested`.
function typeRef(schema, owner, suggested, nested) {
  if (schema.$ref) return { swift: qualified(refName(schema.$ref)), nullable: false };
  const { types, nullable } = typesOf(schema);
  const name = pascal(suggested);
  const here = `${owner}.${name}`;
  const declare = (lines) => {
    if (nested.some((n) => n.name === name)) throw new Error(`two nested types named ${here}`);
    nested.push({ name, lines });
    return { swift: here, nullable };
  };
  if (schema.oneOf) return declare(oneOfDecl(name, here, schema));
  if (schema.allOf) return declare(structDecl(name, here, schema));
  if (types.length > 1) throw new Error(`${here}: multi-type schemas are not supported`);
  switch (types[0]) {
    case undefined:
      if (schema.properties) return declare(structDecl(name, here, schema));
      // Any value; JSONValue has its own `.null`.
      return { swift: `${NS}.JSONValue`, nullable: false };
    case "string":
      if (schema.enum) return declare(enumDecl(name, schema));
      return { swift: "String", nullable };
    case "integer":
      return { swift: "Int", nullable };
    case "number":
      return { swift: "Double", nullable };
    case "boolean":
      return { swift: "Bool", nullable };
    case "array": {
      const item = typeRef(schema.items ?? {}, owner, `${name}Item`, nested);
      return { swift: `[${item.swift}${item.nullable ? "?" : ""}]`, nullable };
    }
    case "object": {
      if (schema.properties) return declare(structDecl(name, here, schema));
      const ap = schema.additionalProperties;
      if (ap && typeof ap === "object" && Object.keys(ap).length > 0) {
        const value = typeRef(ap, owner, `${name}Value`, nested);
        return { swift: `[String: ${value.swift}${value.nullable ? "?" : ""}]`, nullable };
      }
      return { swift: `[String: ${NS}.JSONValue]`, nullable };
    }
    default:
      throw new Error(`${here}: unsupported type ${types[0]}`);
  }
}

function enumDecl(name, schema) {
  const values = schema.enum.map(String);
  const cases = values.map((v) => ({ id: ident(camel(v)), raw: v }));
  return [
    ...doc(schema.description),
    `/// Unknown values decode too (the API is additive): compare against the`,
    `/// constants below and keep a fallback for the rest.`,
    `public struct ${name}: RawRepresentable, Codable, Hashable, Sendable {`,
    `    public var rawValue: String`,
    `    public init(rawValue: String) { self.rawValue = rawValue }`,
    ``,
    ...cases.map((c) => `    public static let ${c.id} = Self(rawValue: ${str(c.raw)})`),
    ``,
    `    /// The values this build knows.`,
    `    public static let knownValues: [Self] = [${cases.map((c) => `.${c.id}`).join(", ")}]`,
    `    public var isKnown: Bool { Self.knownValues.contains(self) }`,
    `}`,
  ];
}

function structDecl(name, qual, schema) {
  const flat = flatten(schema, qual);
  const nested = [];
  const props = [];
  for (const [jsonName, { schema: ps, owner }] of flat.props) {
    // Types from a referenced component are declared there; only inline ones are ours.
    const t = typeRef(ps, owner, pascal(jsonName), owner === qual ? nested : []);
    const required = flat.required.has(jsonName);
    const optional = !required || t.nullable;
    const swiftName = camel(jsonName);
    if (swiftName === "additionalProperties" && flat.additional === true) {
      throw new Error(`${qual}: property name clashes with additionalProperties`);
    }
    let dflt = optional ? "nil" : undefined;
    if (required && ps.const !== undefined) dflt = typeof ps.const === "string" ? str(ps.const) : String(ps.const);
    props.push({
      jsonName,
      id: ident(swiftName),
      key: swiftName,
      type: `${t.swift}${optional ? "?" : ""}`,
      optional,
      dflt,
      description: ps.description,
    });
  }
  const extras = flat.additional === true || (flat.additional && Object.keys(flat.additional).length === 0);
  if (flat.additional && !extras) {
    // Typed extra properties next to named ones don't occur in the spec; refuse rather than guess.
    throw new Error(`${qual}: typed additionalProperties alongside properties is not supported`);
  }

  const lines = [...doc(schema.description), `public struct ${name}: Codable, Sendable, Equatable {`];
  const body = [];
  for (const p of props) {
    body.push(...doc(p.description), `public var ${p.id}: ${p.type}`);
  }
  if (extras) {
    body.push(`/// Properties the spec doesn't name, kept as they came.`);
    body.push(`public var additionalProperties: [String: ${NS}.JSONValue]`);
  }
  body.push("");
  const params = props.map((p) => `${p.id}: ${p.type}${p.dflt !== undefined ? ` = ${p.dflt}` : ""}`);
  if (extras) params.push(`additionalProperties: [String: ${NS}.JSONValue] = [:]`);
  if (params.length === 0) {
    body.push(`public init() {}`);
  } else {
    body.push(`public init(`, ...params.map((p, i) => `    ${p}${i < params.length - 1 ? "," : ""}`), `) {`);
    for (const p of props) body.push(`    self.${p.id} = ${p.id}`);
    if (extras) body.push(`    self.additionalProperties = additionalProperties`);
    body.push(`}`);
  }
  const needsKeys = extras || props.some((p) => p.key !== p.jsonName);
  if (needsKeys && props.length > 0) {
    body.push("", `enum CodingKeys: String, CodingKey {`);
    for (const p of props) body.push(`    case ${p.id}${p.key !== p.jsonName ? ` = ${str(p.jsonName)}` : ""}`);
    body.push(`}`);
  }
  if (extras) {
    const keyed = props.length > 0;
    body.push("", `public init(from decoder: any Decoder) throws {`);
    if (keyed) body.push(`    let container = try decoder.container(keyedBy: CodingKeys.self)`);
    for (const p of props) {
      const bare = p.type.replace(/\?$/, "");
      body.push(
        p.optional
          ? `    self.${p.id} = try container.decodeIfPresent(${bare}.self, forKey: .${p.id})`
          : `    self.${p.id} = try container.decode(${bare}.self, forKey: .${p.id})`,
      );
    }
    body.push(
      `    let all = try decoder.container(keyedBy: ${NS}.AnyCodingKey.self)`,
      `    var extra: [String: ${NS}.JSONValue] = [:]`,
      `    for key in all.allKeys where ${keyed ? "CodingKeys(rawValue: key.stringValue) == nil" : "true"} {`,
      `        extra[key.stringValue] = try all.decode(${NS}.JSONValue.self, forKey: key)`,
      `    }`,
      `    self.additionalProperties = extra`,
      `}`,
      "",
      `public func encode(to encoder: any Encoder) throws {`,
    );
    if (keyed) body.push(`    var container = encoder.container(keyedBy: CodingKeys.self)`);
    for (const p of props) {
      body.push(
        p.optional
          ? `    try container.encodeIfPresent(${p.id}, forKey: .${p.id})`
          : `    try container.encode(${p.id}, forKey: .${p.id})`,
      );
    }
    body.push(
      `    var all = encoder.container(keyedBy: ${NS}.AnyCodingKey.self)`,
      `    for (key, value) in additionalProperties where ${keyed ? "CodingKeys(rawValue: key) == nil" : "true"} {`,
      `        try all.encode(value, forKey: ${NS}.AnyCodingKey(key))`,
      `    }`,
      `}`,
    );
  }
  for (const n of nested) body.push("", ...n.lines);
  while (body[body.length - 1] === "") body.pop();
  return [...lines, ...indent(body), `}`];
}

function oneOfDecl(name, qual, schema) {
  const variants = schema.oneOf;
  const disc = schema.discriminator;
  if (disc && disc.propertyName !== "kind") throw new Error(`${qual}: only \`kind\` discriminators are supported`);
  const kinds = variants.map(kindValues);
  if (disc || kinds.every(Boolean)) return kindEnumDecl(name, qual, schema, kinds);
  return untaggedEnumDecl(name, qual, schema);
}

// oneOf discriminated by `kind`: one case per mapping entry (or per variant when
// the kinds come from the variants' own `kind` constants), plus `.unknown`.
function kindEnumDecl(name, qual, schema, kinds) {
  const cases = [];
  if (schema.discriminator?.mapping) {
    for (const [kind, ref] of Object.entries(schema.discriminator.mapping)) {
      cases.push({ id: ident(camel(kind)), kinds: [kind], type: qualified(refName(ref)) });
    }
  } else {
    schema.oneOf.forEach((v, i) => {
      if (!v.$ref) throw new Error(`${qual}: inline variants of a kind union are not supported`);
      cases.push({ id: ident(lowerFirst(topName(refName(v.$ref)))), kinds: kinds[i], type: qualified(refName(v.$ref)) });
    });
  }
  const seen = new Set();
  for (const c of cases) {
    if (c.id === "unknown") throw new Error(`${qual}: a case named unknown clashes with the fallback`);
    for (const k of c.kinds) {
      if (seen.has(k)) throw new Error(`${qual}: kind ${k} maps twice`);
      seen.add(k);
    }
  }
  return [
    ...doc(schema.description),
    `public enum ${name}: Codable, Sendable, Equatable {`,
    ...indent([
      ...cases.map((c) => `case ${c.id}(${c.type})`),
      `/// A kind this build doesn't know (new kinds are additive): ignore it.`,
      `case unknown(kind: String, payload: ${NS}.JSONValue)`,
      "",
      `/// The \`kind\` this value was decoded from.`,
      `public var kind: String {`,
      `    switch self {`,
      ...cases.map((c) =>
        c.kinds.length === 1
          ? `    case .${c.id}: return ${str(c.kinds[0])}`
          : `    case .${c.id}(let value): return value.kind`,
      ),
      `    case .unknown(let kind, _): return kind`,
      `    }`,
      `}`,
      "",
      `private enum DiscriminatorKeys: String, CodingKey { case kind }`,
      "",
      `public init(from decoder: any Decoder) throws {`,
      `    let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)`,
      `    switch kind {`,
      ...cases.map(
        (c) => `    case ${c.kinds.map(str).join(", ")}: self = .${c.id}(try ${c.type}(from: decoder))`,
      ),
      `    default: self = .unknown(kind: kind, payload: try ${NS}.JSONValue(from: decoder))`,
      `    }`,
      `}`,
      "",
      `public func encode(to encoder: any Encoder) throws {`,
      `    switch self {`,
      ...cases.map((c) => `    case .${c.id}(let value): try value.encode(to: encoder)`),
      `    case .unknown(_, let payload): try payload.encode(to: encoder)`,
      `    }`,
      `}`,
    ]),
    `}`,
  ];
}

// Any other oneOf: decoding tries the variants in order.
function untaggedEnumDecl(name, qual, schema) {
  const nested = [];
  const cases = schema.oneOf.map((v) => {
    let id;
    if (v.$ref) id = lowerFirst(topName(refName(v.$ref)));
    else {
      const t = typesOf(v).types[0] ?? "value";
      id = { integer: "int", boolean: "bool" }[t] ?? t;
    }
    const t = typeRef(v, qual, pascal(id), nested);
    return { id: ident(id), type: `${t.swift}${t.nullable ? "?" : ""}` };
  });
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error(`${qual}: variants need distinct case names`);
  const body = [
    ...cases.map((c) => `case ${c.id}(${c.type})`),
    "",
    `public init(from decoder: any Decoder) throws {`,
    `    let container = try decoder.singleValueContainer()`,
    ...cases.map((c) => `    if let value = try? container.decode(${c.type}.self) { self = .${c.id}(value); return }`),
    `    throw DecodingError.dataCorruptedError(in: container, debugDescription: "No variant of ${name} matched")`,
    `}`,
    "",
    `public func encode(to encoder: any Encoder) throws {`,
    `    var container = encoder.singleValueContainer()`,
    `    switch self {`,
    ...cases.map((c) => `    case .${c.id}(let value): try container.encode(value)`),
    `    }`,
    `}`,
  ];
  for (const n of nested) body.push("", ...n.lines);
  return [...doc(schema.description), `public enum ${name}: Codable, Sendable, Equatable {`, ...indent(body), `}`];
}

function topLevelDecl(schemaName, schema) {
  const name = topName(schemaName);
  const qual = `${NS}.${name}`;
  if (schema.oneOf) return oneOfDecl(name, qual, schema);
  const { types } = typesOf(schema);
  if (types[0] === "string" && schema.enum) return enumDecl(name, schema);
  if (isObjectLike(schema) && (schema.allOf || schema.properties)) return structDecl(name, qual, schema);
  const nested = [];
  const t = typeRef(schema, NS, `${name}Value`, nested);
  if (nested.length) throw new Error(`${qual}: unsupported top-level shape`);
  return [...doc(schema.description), `public typealias ${name} = ${t.swift}${t.nullable ? "?" : ""}`];
}

// ---------------------------------------------------------------- output

const runtime = [
  `/// Any JSON value: the spec's free-form fields (\`{}\`, \`additionalProperties: true\`).`,
  `public enum JSONValue: Codable, Sendable, Hashable {`,
  `    case null`,
  `    case bool(Bool)`,
  `    case number(Double)`,
  `    case string(String)`,
  `    case array([JSONValue])`,
  `    case object([String: JSONValue])`,
  ``,
  `    public init(from decoder: any Decoder) throws {`,
  `        let container = try decoder.singleValueContainer()`,
  `        if container.decodeNil() { self = .null }`,
  `        else if let value = try? container.decode(Bool.self) { self = .bool(value) }`,
  `        else if let value = try? container.decode(Double.self) { self = .number(value) }`,
  `        else if let value = try? container.decode(String.self) { self = .string(value) }`,
  `        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }`,
  `        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }`,
  `        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a JSON value") }`,
  `    }`,
  ``,
  `    public func encode(to encoder: any Encoder) throws {`,
  `        var container = encoder.singleValueContainer()`,
  `        switch self {`,
  `        case .null: try container.encodeNil()`,
  `        case .bool(let value): try container.encode(value)`,
  `        case .number(let value): try container.encode(value)`,
  `        case .string(let value): try container.encode(value)`,
  `        case .array(let value): try container.encode(value)`,
  `        case .object(let value): try container.encode(value)`,
  `        }`,
  `    }`,
  `}`,
  ``,
  `/// A coding key for any string: reads and writes the keys a struct doesn't name.`,
  `public struct AnyCodingKey: CodingKey, Hashable, Sendable {`,
  `    public var stringValue: String`,
  `    public var intValue: Int? { nil }`,
  `    public init(_ stringValue: String) { self.stringValue = stringValue }`,
  `    public init?(stringValue: String) { self.stringValue = stringValue }`,
  `    public init?(intValue: Int) { return nil }`,
  `}`,
];

const decls = [];
for (const [name, schema] of Object.entries(schemas)) decls.push("", ...topLevelDecl(name, schema));

const version = spec.info?.version ? ` (spec version ${spec.info.version})` : "";
const output = [
  `// CeliadorAPI.swift — GENERATED — DO NOT EDIT.`,
  `//`,
  `// Generated from packages/client/openapi.yaml${version} by`,
  `// packages/client/scripts/generate-swift.mjs. Regenerate with`,
  `// \`npm run generate\` in packages/client; CI fails when this file is stale.`,
  `//`,
  `// Types for components.schemas only, standard library only (no Foundation),`,
  `// so it compiles into the app, the widgets and the Live Activity alike.`,
  `// Unknown enum values and unknown \`kind\`s decode instead of failing: the`,
  `// API is additive-only (packages/client/README.md).`,
  ``,
  `/// The daemon's API types (packages/client/openapi.yaml, components.schemas).`,
  `public enum ${NS} {`,
  ...indent([...runtime, ...decls]),
  `}`,
  ``,
].join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf8");
  } catch {}
  if (current !== output) {
    console.error(`swift/CeliadorAPI.swift is out of date with openapi.yaml; run \`npm run generate\` and commit it.`);
    process.exit(1);
  }
  console.log("swift/CeliadorAPI.swift is up to date.");
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output);
  console.log(`wrote ${outPath}`);
}
