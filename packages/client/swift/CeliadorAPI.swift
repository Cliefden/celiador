// CeliadorAPI.swift — GENERATED — DO NOT EDIT.
//
// Generated from packages/client/openapi.yaml (spec version 0.3.0) by
// packages/client/scripts/generate-swift.mjs. Regenerate with
// `npm run generate` in packages/client; CI fails when this file is stale.
//
// Types for components.schemas only, standard library only (no Foundation),
// so it compiles into the app, the widgets and the Live Activity alike.
// Unknown enum values and unknown `kind`s decode instead of failing: the
// API is additive-only (packages/client/README.md).

/// The daemon's API types (packages/client/openapi.yaml, components.schemas).
public enum CeliadorAPI {
    /// Any JSON value: the spec's free-form fields (`{}`, `additionalProperties: true`).
    public enum JSONValue: Codable, Sendable, Hashable {
        case null
        case bool(Bool)
        case number(Double)
        case string(String)
        case array([JSONValue])
        case object([String: JSONValue])

        public init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() { self = .null }
            else if let value = try? container.decode(Bool.self) { self = .bool(value) }
            else if let value = try? container.decode(Double.self) { self = .number(value) }
            else if let value = try? container.decode(String.self) { self = .string(value) }
            else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
            else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
            else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not a JSON value") }
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .null: try container.encodeNil()
            case .bool(let value): try container.encode(value)
            case .number(let value): try container.encode(value)
            case .string(let value): try container.encode(value)
            case .array(let value): try container.encode(value)
            case .object(let value): try container.encode(value)
            }
        }
    }

    /// A coding key for any string: reads and writes the keys a struct doesn't name.
    public struct AnyCodingKey: CodingKey, Hashable, Sendable {
        public var stringValue: String
        public var intValue: Int? { nil }
        public init(_ stringValue: String) { self.stringValue = stringValue }
        public init?(stringValue: String) { self.stringValue = stringValue }
        public init?(intValue: Int) { return nil }
    }

    public struct Error: Codable, Sendable, Equatable {
        public var error: String

        public init(
            error: String
        ) {
            self.error = error
        }
    }

    public struct Ok: Codable, Sendable, Equatable {
        public var ok: Bool

        public init(
            ok: Bool = true
        ) {
            self.ok = ok
        }
    }

    public struct OkFlag: Codable, Sendable, Equatable {
        public var ok: Bool

        public init(
            ok: Bool
        ) {
            self.ok = ok
        }
    }

    public struct TextRequest: Codable, Sendable, Equatable {
        public var text: String

        public init(
            text: String
        ) {
            self.text = text
        }
    }

    public struct RemoteUrlRequest: Codable, Sendable, Equatable {
        /// `https://github.com/<owner>/<name>` (optionally `.git`).
        public var remoteUrl: String

        public init(
            remoteUrl: String
        ) {
            self.remoteUrl = remoteUrl
        }
    }

    public struct MergeRequest: Codable, Sendable, Equatable {
        public var method: CeliadorAPI.MergeRequest.Method?

        public init(
            method: CeliadorAPI.MergeRequest.Method? = nil
        ) {
            self.method = method
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Method: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let merge = Self(rawValue: "merge")
            public static let squash = Self(rawValue: "squash")
            public static let rebase = Self(rawValue: "rebase")

            /// The values this build knows.
            public static let knownValues: [Self] = [.merge, .squash, .rebase]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    /// Anthropic's error envelope.
    public struct AnthropicError: Codable, Sendable, Equatable {
        public var type: String
        public var error: CeliadorAPI.AnthropicError.Error
        public var requestId: String?

        public init(
            type: String = "error",
            error: CeliadorAPI.AnthropicError.Error,
            requestId: String? = nil
        ) {
            self.type = type
            self.error = error
            self.requestId = requestId
        }

        enum CodingKeys: String, CodingKey {
            case type
            case error
            case requestId = "request_id"
        }

        public struct Error: Codable, Sendable, Equatable {
            /// `authentication_error`, `permission_error`, `rate_limit_error`, `overloaded_error`, or upstream's own.
            public var type: String
            public var message: String

            public init(
                type: String,
                message: String
            ) {
                self.type = type
                self.message = message
            }
        }
    }

    public struct FailureCounter: Codable, Sendable, Equatable {
        public var count: Int
        public var lastAt: String?

        public init(
            count: Int,
            lastAt: String? = nil
        ) {
            self.count = count
            self.lastAt = lastAt
        }
    }

    public struct Health: Codable, Sendable, Equatable {
        public var ok: Bool
        public var name: String
        public var version: String
        /// `dev`, `test`, `prod` or `local`.
        public var env: String
        public var commit: String?
        public var pid: Int
        /// Background failure counters since the process started.
        public var failures: CeliadorAPI.Health.Failures

        public init(
            ok: Bool = true,
            name: String = "celiador-daemon",
            version: String,
            env: String,
            commit: String? = nil,
            pid: Int,
            failures: CeliadorAPI.Health.Failures
        ) {
            self.ok = ok
            self.name = name
            self.version = version
            self.env = env
            self.commit = commit
            self.pid = pid
            self.failures = failures
        }

        /// Background failure counters since the process started.
        public struct Failures: Codable, Sendable, Equatable {
            public var since: String
            public var persist: CeliadorAPI.FailureCounter
            public var push: CeliadorAPI.FailureCounter

            public init(
                since: String,
                persist: CeliadorAPI.FailureCounter,
                push: CeliadorAPI.FailureCounter
            ) {
                self.since = since
                self.persist = persist
                self.push = push
            }
        }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct AuthMode: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let supabase = Self(rawValue: "supabase")
        public static let token = Self(rawValue: "token")
        public static let none = Self(rawValue: "none")

        /// The values this build knows.
        public static let knownValues: [Self] = [.supabase, .token, .none]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    public struct SignInMethods: Codable, Sendable, Equatable {
        public var password: Bool
        public var magicLink: Bool
        public var github: Bool

        public init(
            password: Bool,
            magicLink: Bool,
            github: Bool
        ) {
            self.password = password
            self.magicLink = magicLink
            self.github = github
        }
    }

    public struct Config: Codable, Sendable, Equatable {
        public var authMode: CeliadorAPI.AuthMode
        public var supabaseUrl: String?
        public var supabaseAnonKey: String?
        public var signIn: CeliadorAPI.SignInMethods?

        public init(
            authMode: CeliadorAPI.AuthMode,
            supabaseUrl: String? = nil,
            supabaseAnonKey: String? = nil,
            signIn: CeliadorAPI.SignInMethods? = nil
        ) {
            self.authMode = authMode
            self.supabaseUrl = supabaseUrl
            self.supabaseAnonKey = supabaseAnonKey
            self.signIn = signIn
        }
    }

    /// Per-user limits; 0 means unlimited.
    public struct UserLimits: Codable, Sendable, Equatable {
        /// Requests per minute.
        public var rpm: Double
        /// Agent requests in flight at once.
        public var concurrency: Double
        public var dailyRequests: Double
        /// Daily budget in USD at the published rates.
        public var dailyUsd: Double
        /// Daily input tokens.
        public var dailyInput: Double
        /// Daily output tokens.
        public var dailyOutput: Double

        public init(
            rpm: Double,
            concurrency: Double,
            dailyRequests: Double,
            dailyUsd: Double,
            dailyInput: Double,
            dailyOutput: Double
        ) {
            self.rpm = rpm
            self.concurrency = concurrency
            self.dailyRequests = dailyRequests
            self.dailyUsd = dailyUsd
            self.dailyInput = dailyInput
            self.dailyOutput = dailyOutput
        }
    }

    /// USD per million tokens.
    public struct Prices: Codable, Sendable, Equatable {
        public var currency: String
        public var model: String
        public var inputPerMtok: Double
        /// 5-minute cache TTL.
        public var cacheWritePerMtok: Double
        /// 1-hour cache TTL.
        public var cacheWrite1hPerMtok: Double
        public var cacheReadPerMtok: Double
        public var outputPerMtok: Double

        public init(
            currency: String = "USD",
            model: String,
            inputPerMtok: Double,
            cacheWritePerMtok: Double,
            cacheWrite1hPerMtok: Double,
            cacheReadPerMtok: Double,
            outputPerMtok: Double
        ) {
            self.currency = currency
            self.model = model
            self.inputPerMtok = inputPerMtok
            self.cacheWritePerMtok = cacheWritePerMtok
            self.cacheWrite1hPerMtok = cacheWrite1hPerMtok
            self.cacheReadPerMtok = cacheReadPerMtok
            self.outputPerMtok = outputPerMtok
        }
    }

    public struct Limits: Codable, Sendable, Equatable {
        public var plan: String
        /// The agent model.
        public var model: String
        public var limits: CeliadorAPI.UserLimits
        public var tasks: CeliadorAPI.Limits.Tasks
        public var prices: CeliadorAPI.Prices
        /// Rate cards for every model the gateway runs, by model id.
        public var modelPrices: [String: CeliadorAPI.Prices]
        public var window: String

        public init(
            plan: String,
            model: String,
            limits: CeliadorAPI.UserLimits,
            tasks: CeliadorAPI.Limits.Tasks,
            prices: CeliadorAPI.Prices,
            modelPrices: [String: CeliadorAPI.Prices],
            window: String
        ) {
            self.plan = plan
            self.model = model
            self.limits = limits
            self.tasks = tasks
            self.prices = prices
            self.modelPrices = modelPrices
            self.window = window
        }

        public struct Tasks: Codable, Sendable, Equatable {
            /// Agent tasks running at once per user.
            public var concurrency: Int

            public init(
                concurrency: Int
            ) {
                self.concurrency = concurrency
            }
        }
    }

    public struct AnthropicMessage: Codable, Sendable, Equatable {
        public var role: CeliadorAPI.AnthropicMessage.Role
        public var content: CeliadorAPI.AnthropicMessage.Content

        public init(
            role: CeliadorAPI.AnthropicMessage.Role,
            content: CeliadorAPI.AnthropicMessage.Content
        ) {
            self.role = role
            self.content = content
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Role: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let user = Self(rawValue: "user")
            public static let assistant = Self(rawValue: "assistant")

            /// The values this build knows.
            public static let knownValues: [Self] = [.user, .assistant]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }

        public enum Content: Codable, Sendable, Equatable {
            case string(String)
            case array([CeliadorAPI.AnthropicMessage.Content.ArrayItem])

            public init(from decoder: any Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let value = try? container.decode(String.self) { self = .string(value); return }
                if let value = try? container.decode([CeliadorAPI.AnthropicMessage.Content.ArrayItem].self) { self = .array(value); return }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "No variant of Content matched")
            }

            public func encode(to encoder: any Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .string(let value): try container.encode(value)
                case .array(let value): try container.encode(value)
                }
            }

            public struct ArrayItem: Codable, Sendable, Equatable {
                public var type: String
                /// Properties the spec doesn't name, kept as they came.
                public var additionalProperties: [String: CeliadorAPI.JSONValue]

                public init(
                    type: String,
                    additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
                ) {
                    self.type = type
                    self.additionalProperties = additionalProperties
                }

                enum CodingKeys: String, CodingKey {
                    case type
                }

                public init(from decoder: any Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    self.type = try container.decode(String.self, forKey: .type)
                    let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
                    var extra: [String: CeliadorAPI.JSONValue] = [:]
                    for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                        extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
                    }
                    self.additionalProperties = extra
                }

                public func encode(to encoder: any Encoder) throws {
                    var container = encoder.container(keyedBy: CodingKeys.self)
                    try container.encode(type, forKey: .type)
                    var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
                    for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                        try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
                    }
                }
            }
        }
    }

    public struct AgentMessagesRequest: Codable, Sendable, Equatable {
        public var messages: [CeliadorAPI.AnthropicMessage]
        /// Lowers the daemon's cap; can't raise it.
        public var maxTokens: Int?

        public init(
            messages: [CeliadorAPI.AnthropicMessage],
            maxTokens: Int? = nil
        ) {
            self.messages = messages
            self.maxTokens = maxTokens
        }

        enum CodingKeys: String, CodingKey {
            case messages
            case maxTokens = "max_tokens"
        }
    }

    /// An Anthropic Messages API request. `model` is honoured only when the
    /// daemon allows it; `max_tokens` is capped. Messages may also carry the
    /// `system` role. Server-side tools and some fields are refused (400).
    public struct GatewayMessagesRequest: Codable, Sendable, Equatable {
        public var model: String?
        public var maxTokens: Int?
        public var stream: Bool?
        public var system: CeliadorAPI.GatewayMessagesRequest.System?
        public var tools: [CeliadorAPI.GatewayMessagesRequest.ToolsItem]?
        public var messages: [CeliadorAPI.GatewayMessagesRequest.MessagesItem]
        /// Properties the spec doesn't name, kept as they came.
        public var additionalProperties: [String: CeliadorAPI.JSONValue]

        public init(
            model: String? = nil,
            maxTokens: Int? = nil,
            stream: Bool? = nil,
            system: CeliadorAPI.GatewayMessagesRequest.System? = nil,
            tools: [CeliadorAPI.GatewayMessagesRequest.ToolsItem]? = nil,
            messages: [CeliadorAPI.GatewayMessagesRequest.MessagesItem],
            additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
        ) {
            self.model = model
            self.maxTokens = maxTokens
            self.stream = stream
            self.system = system
            self.tools = tools
            self.messages = messages
            self.additionalProperties = additionalProperties
        }

        enum CodingKeys: String, CodingKey {
            case model
            case maxTokens = "max_tokens"
            case stream
            case system
            case tools
            case messages
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.model = try container.decodeIfPresent(String.self, forKey: .model)
            self.maxTokens = try container.decodeIfPresent(Int.self, forKey: .maxTokens)
            self.stream = try container.decodeIfPresent(Bool.self, forKey: .stream)
            self.system = try container.decodeIfPresent(CeliadorAPI.GatewayMessagesRequest.System.self, forKey: .system)
            self.tools = try container.decodeIfPresent([CeliadorAPI.GatewayMessagesRequest.ToolsItem].self, forKey: .tools)
            self.messages = try container.decode([CeliadorAPI.GatewayMessagesRequest.MessagesItem].self, forKey: .messages)
            let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            var extra: [String: CeliadorAPI.JSONValue] = [:]
            for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
            }
            self.additionalProperties = extra
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(model, forKey: .model)
            try container.encodeIfPresent(maxTokens, forKey: .maxTokens)
            try container.encodeIfPresent(stream, forKey: .stream)
            try container.encodeIfPresent(system, forKey: .system)
            try container.encodeIfPresent(tools, forKey: .tools)
            try container.encode(messages, forKey: .messages)
            var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
            }
        }

        public enum System: Codable, Sendable, Equatable {
            case string(String)
            case array([[String: CeliadorAPI.JSONValue]])

            public init(from decoder: any Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let value = try? container.decode(String.self) { self = .string(value); return }
                if let value = try? container.decode([[String: CeliadorAPI.JSONValue]].self) { self = .array(value); return }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "No variant of System matched")
            }

            public func encode(to encoder: any Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .string(let value): try container.encode(value)
                case .array(let value): try container.encode(value)
                }
            }
        }

        public struct ToolsItem: Codable, Sendable, Equatable {
            public var name: String
            public var type: String?
            /// Properties the spec doesn't name, kept as they came.
            public var additionalProperties: [String: CeliadorAPI.JSONValue]

            public init(
                name: String,
                type: String? = nil,
                additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
            ) {
                self.name = name
                self.type = type
                self.additionalProperties = additionalProperties
            }

            enum CodingKeys: String, CodingKey {
                case name
                case type
            }

            public init(from decoder: any Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                self.name = try container.decode(String.self, forKey: .name)
                self.type = try container.decodeIfPresent(String.self, forKey: .type)
                let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
                var extra: [String: CeliadorAPI.JSONValue] = [:]
                for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                    extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
                }
                self.additionalProperties = extra
            }

            public func encode(to encoder: any Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(name, forKey: .name)
                try container.encodeIfPresent(type, forKey: .type)
                var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
                for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                    try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
                }
            }
        }

        public struct MessagesItem: Codable, Sendable, Equatable {
            public var role: CeliadorAPI.GatewayMessagesRequest.MessagesItem.Role
            public var content: CeliadorAPI.GatewayMessagesRequest.MessagesItem.Content

            public init(
                role: CeliadorAPI.GatewayMessagesRequest.MessagesItem.Role,
                content: CeliadorAPI.GatewayMessagesRequest.MessagesItem.Content
            ) {
                self.role = role
                self.content = content
            }

            /// Unknown values decode too (the API is additive): compare against the
            /// constants below and keep a fallback for the rest.
            public struct Role: RawRepresentable, Codable, Hashable, Sendable {
                public var rawValue: String
                public init(rawValue: String) { self.rawValue = rawValue }

                public static let user = Self(rawValue: "user")
                public static let assistant = Self(rawValue: "assistant")
                public static let system = Self(rawValue: "system")

                /// The values this build knows.
                public static let knownValues: [Self] = [.user, .assistant, .system]
                public var isKnown: Bool { Self.knownValues.contains(self) }
            }

            public enum Content: Codable, Sendable, Equatable {
                case string(String)
                case array([[String: CeliadorAPI.JSONValue]])

                public init(from decoder: any Decoder) throws {
                    let container = try decoder.singleValueContainer()
                    if let value = try? container.decode(String.self) { self = .string(value); return }
                    if let value = try? container.decode([[String: CeliadorAPI.JSONValue]].self) { self = .array(value); return }
                    throw DecodingError.dataCorruptedError(in: container, debugDescription: "No variant of Content matched")
                }

                public func encode(to encoder: any Encoder) throws {
                    var container = encoder.singleValueContainer()
                    switch self {
                    case .string(let value): try container.encode(value)
                    case .array(let value): try container.encode(value)
                    }
                }
            }
        }
    }

    /// One Anthropic Messages stream event (`message_start`, `content_block_delta`, ...), relayed as is.
    public struct AnthropicStreamEvent: Codable, Sendable, Equatable {
        public var type: String
        /// Properties the spec doesn't name, kept as they came.
        public var additionalProperties: [String: CeliadorAPI.JSONValue]

        public init(
            type: String,
            additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
        ) {
            self.type = type
            self.additionalProperties = additionalProperties
        }

        enum CodingKeys: String, CodingKey {
            case type
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.type = try container.decode(String.self, forKey: .type)
            let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            var extra: [String: CeliadorAPI.JSONValue] = [:]
            for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
            }
            self.additionalProperties = extra
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(type, forKey: .type)
            var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
            }
        }
    }

    /// Sent on the agent proxy's stream when the upstream request failed.
    public struct AgentStreamError: Codable, Sendable, Equatable {
        public var type: String
        public var error: CeliadorAPI.AgentStreamError.Error

        public init(
            type: String = "error",
            error: CeliadorAPI.AgentStreamError.Error
        ) {
            self.type = type
            self.error = error
        }

        public struct Error: Codable, Sendable, Equatable {
            public var message: String

            public init(
                message: String
            ) {
                self.message = message
            }
        }
    }

    public struct CompleteRequest: Codable, Sendable, Equatable {
        /// Code before the caret.
        public var prefix: String?
        /// Code after the caret.
        public var suffix: String?
        /// A language id such as `typescript`.
        public var language: String?

        public init(
            prefix: String? = nil,
            suffix: String? = nil,
            language: String? = nil
        ) {
            self.prefix = prefix
            self.suffix = suffix
            self.language = language
        }
    }

    public struct CompleteResponse: Codable, Sendable, Equatable {
        public var completion: String

        public init(
            completion: String
        ) {
            self.completion = completion
        }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct SessionOrigin: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let editor = Self(rawValue: "editor")
        public static let phone = Self(rawValue: "phone")

        /// The values this build knows.
        public static let knownValues: [Self] = [.editor, .phone]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    /// `editor`: the user's editor runs it. `server`: a cloud session the daemon runs.
    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct SessionRunner: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let editor = Self(rawValue: "editor")
        public static let server = Self(rawValue: "server")

        /// The values this build knows.
        public static let knownValues: [Self] = [.editor, .server]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct SessionState: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let idle = Self(rawValue: "idle")
        public static let running = Self(rawValue: "running")
        public static let awaiting = Self(rawValue: "awaiting")
        public static let done = Self(rawValue: "done")
        public static let error = Self(rawValue: "error")
        public static let cancelled = Self(rawValue: "cancelled")

        /// The values this build knows.
        public static let knownValues: [Self] = [.idle, .running, .awaiting, .done, .error, .cancelled]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    /// Model usage at the daemon's published rates.
    public struct Usage: Codable, Sendable, Equatable {
        public var requests: Int
        /// Total input, cache reads and writes included.
        public var inputTokens: Int
        public var cacheReadTokens: Int
        public var cacheWriteTokens: Int
        public var outputTokens: Int
        public var costUsd: Double

        public init(
            requests: Int,
            inputTokens: Int,
            cacheReadTokens: Int,
            cacheWriteTokens: Int,
            outputTokens: Int,
            costUsd: Double
        ) {
            self.requests = requests
            self.inputTokens = inputTokens
            self.cacheReadTokens = cacheReadTokens
            self.cacheWriteTokens = cacheWriteTokens
            self.outputTokens = outputTokens
            self.costUsd = costUsd
        }
    }

    /// A cloud session's checkout.
    public struct SessionRepo: Codable, Sendable, Equatable {
        public var url: String
        public var owner: String?
        public var name: String?
        /// Where commits and pushes go.
        public var branch: String
        /// What `branch` started from; the pull request's base.
        public var base: String
        public var existingBranch: Bool
        /// Whether push / pull request / merge are available.
        public var pushable: Bool
        public var remoteSha: String
        public var pr: CeliadorAPI.SessionRepo.Pr?

        public init(
            url: String,
            owner: String? = nil,
            name: String? = nil,
            branch: String,
            base: String,
            existingBranch: Bool,
            pushable: Bool,
            remoteSha: String,
            pr: CeliadorAPI.SessionRepo.Pr? = nil
        ) {
            self.url = url
            self.owner = owner
            self.name = name
            self.branch = branch
            self.base = base
            self.existingBranch = existingBranch
            self.pushable = pushable
            self.remoteSha = remoteSha
            self.pr = pr
        }

        public struct Pr: Codable, Sendable, Equatable {
            public var number: Int
            public var url: String

            public init(
                number: Int,
                url: String
            ) {
                self.number = number
                self.url = url
            }
        }
    }

    public struct Session: Codable, Sendable, Equatable {
        public var id: String
        public var userId: String
        public var title: String
        public var origin: CeliadorAPI.SessionOrigin
        public var runner: CeliadorAPI.SessionRunner
        public var state: CeliadorAPI.SessionState
        public var runnerConnected: Bool
        public var lastSeq: Int
        public var createdAt: String
        public var updatedAt: String
        public var mirrorKey: String?
        public var usage: CeliadorAPI.Usage?
        public var repo: CeliadorAPI.SessionRepo?

        public init(
            id: String,
            userId: String,
            title: String,
            origin: CeliadorAPI.SessionOrigin,
            runner: CeliadorAPI.SessionRunner,
            state: CeliadorAPI.SessionState,
            runnerConnected: Bool,
            lastSeq: Int,
            createdAt: String,
            updatedAt: String,
            mirrorKey: String? = nil,
            usage: CeliadorAPI.Usage? = nil,
            repo: CeliadorAPI.SessionRepo? = nil
        ) {
            self.id = id
            self.userId = userId
            self.title = title
            self.origin = origin
            self.runner = runner
            self.state = state
            self.runnerConnected = runnerConnected
            self.lastSeq = lastSeq
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.mirrorKey = mirrorKey
            self.usage = usage
            self.repo = repo
        }
    }

    public struct SessionEnvelope: Codable, Sendable, Equatable {
        public var session: CeliadorAPI.Session

        public init(
            session: CeliadorAPI.Session
        ) {
            self.session = session
        }
    }

    public struct MirrorConflict: Codable, Sendable, Equatable {
        public var error: String
        public var session: CeliadorAPI.Session

        public init(
            error: String,
            session: CeliadorAPI.Session
        ) {
            self.error = error
            self.session = session
        }
    }

    public struct CreateSessionRequest: Codable, Sendable, Equatable {
        public var title: String?
        public var origin: CeliadorAPI.SessionOrigin?
        public var runner: CeliadorAPI.SessionRunner?
        /// Editor sessions only.
        public var mirrorKey: String?
        public var taskId: String?
        /// Required for `runner = server`.
        public var prompt: String?
        /// Required for `runner = server`.
        public var repo: CeliadorAPI.CreateSessionRequest.Repo?

        public init(
            title: String? = nil,
            origin: CeliadorAPI.SessionOrigin? = nil,
            runner: CeliadorAPI.SessionRunner? = nil,
            mirrorKey: String? = nil,
            taskId: String? = nil,
            prompt: String? = nil,
            repo: CeliadorAPI.CreateSessionRequest.Repo? = nil
        ) {
            self.title = title
            self.origin = origin
            self.runner = runner
            self.mirrorKey = mirrorKey
            self.taskId = taskId
            self.prompt = prompt
            self.repo = repo
        }

        /// Required for `runner = server`.
        public struct Repo: Codable, Sendable, Equatable {
            public var url: String
            /// Start from (or with `existingBranch`, work on) this branch.
            public var branch: String?
            public var existingBranch: Bool?

            public init(
                url: String,
                branch: String? = nil,
                existingBranch: Bool? = nil
            ) {
                self.url = url
                self.branch = branch
                self.existingBranch = existingBranch
            }
        }
    }

    public struct CloudRepo: Codable, Sendable, Equatable {
        public var url: String
        public var owner: String
        public var name: String
        /// Whether the Celiador GitHub App can act on it for this user.
        public var app: Bool
        /// Whether the user's link carries proof of their GitHub access.
        public var verified: Bool
        public var defaultBranch: String?
        public var `private`: Bool?

        public init(
            url: String,
            owner: String,
            name: String,
            app: Bool,
            verified: Bool,
            defaultBranch: String? = nil,
            `private`: Bool? = nil
        ) {
            self.url = url
            self.owner = owner
            self.name = name
            self.app = app
            self.verified = verified
            self.defaultBranch = defaultBranch
            self.`private` = `private`
        }
    }

    public struct CloudBranches: Codable, Sendable, Equatable {
        public var branches: [String]
        public var defaultBranch: String?

        public init(
            branches: [String],
            defaultBranch: String? = nil
        ) {
            self.branches = branches
            self.defaultBranch = defaultBranch
        }
    }

    /// One entry of a session's log. `seq` is monotonic per session (and the
    /// SSE frame id); `at` is an ISO timestamp. Discriminated by `kind`.
    /// Clients must ignore kinds they don't know: new kinds are additive.
    public enum SessionEvent: Codable, Sendable, Equatable {
        case activity(CeliadorAPI.SessionEventActivity)
        case delta(CeliadorAPI.SessionEventDelta)
        case message(CeliadorAPI.SessionEventMessage)
        case tool(CeliadorAPI.SessionEventTool)
        case toolResult(CeliadorAPI.SessionEventToolResult)
        case approval(CeliadorAPI.SessionEventApproval)
        case question(CeliadorAPI.SessionEventQuestion)
        case diff(CeliadorAPI.SessionEventDiff)
        case state(CeliadorAPI.SessionEventState)
        case done(CeliadorAPI.SessionEventDone)
        case error(CeliadorAPI.SessionEventError)
        case truncated(CeliadorAPI.SessionEventTruncated)
        /// A kind this build doesn't know (new kinds are additive): ignore it.
        case unknown(kind: String, payload: CeliadorAPI.JSONValue)

        /// The `kind` this value was decoded from.
        public var kind: String {
            switch self {
            case .activity: return "activity"
            case .delta: return "delta"
            case .message: return "message"
            case .tool: return "tool"
            case .toolResult: return "toolResult"
            case .approval: return "approval"
            case .question: return "question"
            case .diff: return "diff"
            case .state: return "state"
            case .done: return "done"
            case .error: return "error"
            case .truncated: return "truncated"
            case .unknown(let kind, _): return kind
            }
        }

        private enum DiscriminatorKeys: String, CodingKey { case kind }

        public init(from decoder: any Decoder) throws {
            let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)
            switch kind {
            case "activity": self = .activity(try CeliadorAPI.SessionEventActivity(from: decoder))
            case "delta": self = .delta(try CeliadorAPI.SessionEventDelta(from: decoder))
            case "message": self = .message(try CeliadorAPI.SessionEventMessage(from: decoder))
            case "tool": self = .tool(try CeliadorAPI.SessionEventTool(from: decoder))
            case "toolResult": self = .toolResult(try CeliadorAPI.SessionEventToolResult(from: decoder))
            case "approval": self = .approval(try CeliadorAPI.SessionEventApproval(from: decoder))
            case "question": self = .question(try CeliadorAPI.SessionEventQuestion(from: decoder))
            case "diff": self = .diff(try CeliadorAPI.SessionEventDiff(from: decoder))
            case "state": self = .state(try CeliadorAPI.SessionEventState(from: decoder))
            case "done": self = .done(try CeliadorAPI.SessionEventDone(from: decoder))
            case "error": self = .error(try CeliadorAPI.SessionEventError(from: decoder))
            case "truncated": self = .truncated(try CeliadorAPI.SessionEventTruncated(from: decoder))
            default: self = .unknown(kind: kind, payload: try CeliadorAPI.JSONValue(from: decoder))
            }
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .activity(let value): try value.encode(to: encoder)
            case .delta(let value): try value.encode(to: encoder)
            case .message(let value): try value.encode(to: encoder)
            case .tool(let value): try value.encode(to: encoder)
            case .toolResult(let value): try value.encode(to: encoder)
            case .approval(let value): try value.encode(to: encoder)
            case .question(let value): try value.encode(to: encoder)
            case .diff(let value): try value.encode(to: encoder)
            case .state(let value): try value.encode(to: encoder)
            case .done(let value): try value.encode(to: encoder)
            case .error(let value): try value.encode(to: encoder)
            case .truncated(let value): try value.encode(to: encoder)
            case .unknown(_, let payload): try payload.encode(to: encoder)
            }
        }
    }

    public struct SessionEventBase: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String

        public init(
            seq: Int,
            at: String
        ) {
            self.seq = seq
            self.at = at
        }
    }

    public struct SessionEventActivity: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var text: String

        public init(
            seq: Int,
            at: String,
            kind: String = "activity",
            text: String
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.text = text
        }
    }

    public struct SessionEventDelta: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var text: String

        public init(
            seq: Int,
            at: String,
            kind: String = "delta",
            text: String
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.text = text
        }
    }

    public struct SessionEventMessage: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var role: CeliadorAPI.RunnerEventMessage.Role
        public var text: String

        public init(
            seq: Int,
            at: String,
            kind: String = "message",
            role: CeliadorAPI.RunnerEventMessage.Role,
            text: String
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.role = role
            self.text = text
        }
    }

    public struct SessionEventTool: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var callId: String
        public var name: String
        public var input: CeliadorAPI.JSONValue?

        public init(
            seq: Int,
            at: String,
            kind: String = "tool",
            callId: String,
            name: String,
            input: CeliadorAPI.JSONValue? = nil
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.callId = callId
            self.name = name
            self.input = input
        }
    }

    public struct SessionEventToolResult: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var callId: String
        public var ok: Bool

        public init(
            seq: Int,
            at: String,
            kind: String = "toolResult",
            callId: String,
            ok: Bool
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.callId = callId
            self.ok = ok
        }
    }

    public struct SessionEventApproval: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var requestId: String
        /// The tool kind: `write_file`, `edit`, `bash`, ...
        public var approvalKind: String
        public var title: String?
        public var path: String?
        public var preview: String?

        public init(
            seq: Int,
            at: String,
            kind: String = "approval",
            requestId: String,
            approvalKind: String,
            title: String? = nil,
            path: String? = nil,
            preview: String? = nil
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.requestId = requestId
            self.approvalKind = approvalKind
            self.title = title
            self.path = path
            self.preview = preview
        }
    }

    public struct SessionEventQuestion: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var requestId: String
        public var prompt: String
        public var choices: [String]?

        public init(
            seq: Int,
            at: String,
            kind: String = "question",
            requestId: String,
            prompt: String,
            choices: [String]? = nil
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.requestId = requestId
            self.prompt = prompt
            self.choices = choices
        }
    }

    public struct SessionEventDiff: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var path: String
        public var patch: String

        public init(
            seq: Int,
            at: String,
            kind: String = "diff",
            path: String,
            patch: String
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.path = path
            self.patch = patch
        }
    }

    public struct SessionEventState: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var state: CeliadorAPI.SessionState

        public init(
            seq: Int,
            at: String,
            kind: String = "state",
            state: CeliadorAPI.SessionState
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.state = state
        }
    }

    public struct SessionEventDone: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String

        public init(
            seq: Int,
            at: String,
            kind: String = "done"
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
        }
    }

    public struct SessionEventError: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var message: String

        public init(
            seq: Int,
            at: String,
            kind: String = "error",
            message: String
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.message = message
        }
    }

    public struct SessionEventTruncated: Codable, Sendable, Equatable {
        public var seq: Int
        public var at: String
        public var kind: String
        public var from: Int

        public init(
            seq: Int,
            at: String,
            kind: String = "truncated",
            from: Int
        ) {
            self.seq = seq
            self.at = at
            self.kind = kind
            self.from = from
        }
    }

    /// An event as the runner publishes it (the daemon adds `seq` and `at`).
    public enum RunnerEvent: Codable, Sendable, Equatable {
        case activity(CeliadorAPI.RunnerEventActivity)
        case delta(CeliadorAPI.RunnerEventDelta)
        case message(CeliadorAPI.RunnerEventMessage)
        case tool(CeliadorAPI.RunnerEventTool)
        case toolResult(CeliadorAPI.RunnerEventToolResult)
        case approval(CeliadorAPI.RunnerEventApproval)
        case question(CeliadorAPI.RunnerEventQuestion)
        case diff(CeliadorAPI.RunnerEventDiff)
        case state(CeliadorAPI.RunnerEventState)
        case done(CeliadorAPI.RunnerEventDone)
        case error(CeliadorAPI.RunnerEventError)
        /// A kind this build doesn't know (new kinds are additive): ignore it.
        case unknown(kind: String, payload: CeliadorAPI.JSONValue)

        /// The `kind` this value was decoded from.
        public var kind: String {
            switch self {
            case .activity: return "activity"
            case .delta: return "delta"
            case .message: return "message"
            case .tool: return "tool"
            case .toolResult: return "toolResult"
            case .approval: return "approval"
            case .question: return "question"
            case .diff: return "diff"
            case .state: return "state"
            case .done: return "done"
            case .error: return "error"
            case .unknown(let kind, _): return kind
            }
        }

        private enum DiscriminatorKeys: String, CodingKey { case kind }

        public init(from decoder: any Decoder) throws {
            let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)
            switch kind {
            case "activity": self = .activity(try CeliadorAPI.RunnerEventActivity(from: decoder))
            case "delta": self = .delta(try CeliadorAPI.RunnerEventDelta(from: decoder))
            case "message": self = .message(try CeliadorAPI.RunnerEventMessage(from: decoder))
            case "tool": self = .tool(try CeliadorAPI.RunnerEventTool(from: decoder))
            case "toolResult": self = .toolResult(try CeliadorAPI.RunnerEventToolResult(from: decoder))
            case "approval": self = .approval(try CeliadorAPI.RunnerEventApproval(from: decoder))
            case "question": self = .question(try CeliadorAPI.RunnerEventQuestion(from: decoder))
            case "diff": self = .diff(try CeliadorAPI.RunnerEventDiff(from: decoder))
            case "state": self = .state(try CeliadorAPI.RunnerEventState(from: decoder))
            case "done": self = .done(try CeliadorAPI.RunnerEventDone(from: decoder))
            case "error": self = .error(try CeliadorAPI.RunnerEventError(from: decoder))
            default: self = .unknown(kind: kind, payload: try CeliadorAPI.JSONValue(from: decoder))
            }
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .activity(let value): try value.encode(to: encoder)
            case .delta(let value): try value.encode(to: encoder)
            case .message(let value): try value.encode(to: encoder)
            case .tool(let value): try value.encode(to: encoder)
            case .toolResult(let value): try value.encode(to: encoder)
            case .approval(let value): try value.encode(to: encoder)
            case .question(let value): try value.encode(to: encoder)
            case .diff(let value): try value.encode(to: encoder)
            case .state(let value): try value.encode(to: encoder)
            case .done(let value): try value.encode(to: encoder)
            case .error(let value): try value.encode(to: encoder)
            case .unknown(_, let payload): try payload.encode(to: encoder)
            }
        }
    }

    /// A one-line status ("Reading src/app.ts").
    public struct RunnerEventActivity: Codable, Sendable, Equatable {
        public var kind: String
        public var text: String

        public init(
            kind: String = "activity",
            text: String
        ) {
            self.kind = kind
            self.text = text
        }
    }

    /// Streamed assistant text.
    public struct RunnerEventDelta: Codable, Sendable, Equatable {
        public var kind: String
        public var text: String

        public init(
            kind: String = "delta",
            text: String
        ) {
            self.kind = kind
            self.text = text
        }
    }

    public struct RunnerEventMessage: Codable, Sendable, Equatable {
        public var kind: String
        public var role: CeliadorAPI.RunnerEventMessage.Role
        public var text: String

        public init(
            kind: String = "message",
            role: CeliadorAPI.RunnerEventMessage.Role,
            text: String
        ) {
            self.kind = kind
            self.role = role
            self.text = text
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Role: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let user = Self(rawValue: "user")
            public static let assistant = Self(rawValue: "assistant")

            /// The values this build knows.
            public static let knownValues: [Self] = [.user, .assistant]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct RunnerEventTool: Codable, Sendable, Equatable {
        public var kind: String
        public var callId: String
        public var name: String
        public var input: CeliadorAPI.JSONValue?

        public init(
            kind: String = "tool",
            callId: String,
            name: String,
            input: CeliadorAPI.JSONValue? = nil
        ) {
            self.kind = kind
            self.callId = callId
            self.name = name
            self.input = input
        }
    }

    public struct RunnerEventToolResult: Codable, Sendable, Equatable {
        public var kind: String
        public var callId: String
        public var ok: Bool

        public init(
            kind: String = "toolResult",
            callId: String,
            ok: Bool
        ) {
            self.kind = kind
            self.callId = callId
            self.ok = ok
        }
    }

    /// The run waits for approve/reject (`POST /approvals/{requestId}`).
    public struct RunnerEventApproval: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        /// The tool kind: `write_file`, `edit`, `bash`, ...
        public var approvalKind: String
        public var title: String?
        public var path: String?
        public var preview: String?

        public init(
            kind: String = "approval",
            requestId: String,
            approvalKind: String,
            title: String? = nil,
            path: String? = nil,
            preview: String? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.approvalKind = approvalKind
            self.title = title
            self.path = path
            self.preview = preview
        }
    }

    /// The run waits for an answer (`POST /answers/{requestId}`).
    public struct RunnerEventQuestion: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var prompt: String
        public var choices: [String]?

        public init(
            kind: String = "question",
            requestId: String,
            prompt: String,
            choices: [String]? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.prompt = prompt
            self.choices = choices
        }
    }

    public struct RunnerEventDiff: Codable, Sendable, Equatable {
        public var kind: String
        public var path: String
        public var patch: String

        public init(
            kind: String = "diff",
            path: String,
            patch: String
        ) {
            self.kind = kind
            self.path = path
            self.patch = patch
        }
    }

    public struct RunnerEventState: Codable, Sendable, Equatable {
        public var kind: String
        public var state: CeliadorAPI.SessionState

        public init(
            kind: String = "state",
            state: CeliadorAPI.SessionState
        ) {
            self.kind = kind
            self.state = state
        }
    }

    public struct RunnerEventDone: Codable, Sendable, Equatable {
        public var kind: String

        public init(
            kind: String = "done"
        ) {
            self.kind = kind
        }
    }

    public struct RunnerEventError: Codable, Sendable, Equatable {
        public var kind: String
        public var message: String

        public init(
            kind: String = "error",
            message: String
        ) {
            self.kind = kind
            self.message = message
        }
    }

    /// What a runner may post to `POST /api/sessions/{id}/events`.
    public enum RunnerFrame: Codable, Sendable, Equatable {
        case runnerEvent(CeliadorAPI.RunnerEvent)
        case fsResultFrame(CeliadorAPI.FsResultFrame)
        /// A kind this build doesn't know (new kinds are additive): ignore it.
        case unknown(kind: String, payload: CeliadorAPI.JSONValue)

        /// The `kind` this value was decoded from.
        public var kind: String {
            switch self {
            case .runnerEvent(let value): return value.kind
            case .fsResultFrame: return "fs.result"
            case .unknown(let kind, _): return kind
            }
        }

        private enum DiscriminatorKeys: String, CodingKey { case kind }

        public init(from decoder: any Decoder) throws {
            let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)
            switch kind {
            case "activity", "delta", "message", "tool", "toolResult", "approval", "question", "diff", "state", "done", "error": self = .runnerEvent(try CeliadorAPI.RunnerEvent(from: decoder))
            case "fs.result": self = .fsResultFrame(try CeliadorAPI.FsResultFrame(from: decoder))
            default: self = .unknown(kind: kind, payload: try CeliadorAPI.JSONValue(from: decoder))
            }
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .runnerEvent(let value): try value.encode(to: encoder)
            case .fsResultFrame(let value): try value.encode(to: encoder)
            case .unknown(_, let payload): try payload.encode(to: encoder)
            }
        }
    }

    /// A command relayed to the runner over `GET /api/sessions/{id}/commands`.
    /// The `fs.*` and `git.*` kinds are requests: the runner answers each with
    /// an `fs.result` frame carrying the same `requestId`. Runners must ignore
    /// kinds they don't know.
    public enum SessionCommand: Codable, Sendable, Equatable {
        case instruct(CeliadorAPI.CommandInstruct)
        case approve(CeliadorAPI.CommandApprove)
        case reject(CeliadorAPI.CommandReject)
        case answer(CeliadorAPI.CommandAnswer)
        case cancel(CeliadorAPI.CommandCancel)
        case fsList(CeliadorAPI.CommandFsList)
        case fsRead(CeliadorAPI.CommandFsRead)
        case fsWrite(CeliadorAPI.CommandFsWrite)
        case gitStatus(CeliadorAPI.CommandGitStatus)
        case gitDiff(CeliadorAPI.CommandGitDiff)
        case gitCommit(CeliadorAPI.CommandGitCommit)
        case gitRevert(CeliadorAPI.CommandGitRevert)
        case gitPush(CeliadorAPI.CommandGitPush)
        case gitPr(CeliadorAPI.CommandGitPr)
        case gitMerge(CeliadorAPI.CommandGitMerge)
        /// A kind this build doesn't know (new kinds are additive): ignore it.
        case unknown(kind: String, payload: CeliadorAPI.JSONValue)

        /// The `kind` this value was decoded from.
        public var kind: String {
            switch self {
            case .instruct: return "instruct"
            case .approve: return "approve"
            case .reject: return "reject"
            case .answer: return "answer"
            case .cancel: return "cancel"
            case .fsList: return "fs.list"
            case .fsRead: return "fs.read"
            case .fsWrite: return "fs.write"
            case .gitStatus: return "git.status"
            case .gitDiff: return "git.diff"
            case .gitCommit: return "git.commit"
            case .gitRevert: return "git.revert"
            case .gitPush: return "git.push"
            case .gitPr: return "git.pr"
            case .gitMerge: return "git.merge"
            case .unknown(let kind, _): return kind
            }
        }

        private enum DiscriminatorKeys: String, CodingKey { case kind }

        public init(from decoder: any Decoder) throws {
            let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)
            switch kind {
            case "instruct": self = .instruct(try CeliadorAPI.CommandInstruct(from: decoder))
            case "approve": self = .approve(try CeliadorAPI.CommandApprove(from: decoder))
            case "reject": self = .reject(try CeliadorAPI.CommandReject(from: decoder))
            case "answer": self = .answer(try CeliadorAPI.CommandAnswer(from: decoder))
            case "cancel": self = .cancel(try CeliadorAPI.CommandCancel(from: decoder))
            case "fs.list": self = .fsList(try CeliadorAPI.CommandFsList(from: decoder))
            case "fs.read": self = .fsRead(try CeliadorAPI.CommandFsRead(from: decoder))
            case "fs.write": self = .fsWrite(try CeliadorAPI.CommandFsWrite(from: decoder))
            case "git.status": self = .gitStatus(try CeliadorAPI.CommandGitStatus(from: decoder))
            case "git.diff": self = .gitDiff(try CeliadorAPI.CommandGitDiff(from: decoder))
            case "git.commit": self = .gitCommit(try CeliadorAPI.CommandGitCommit(from: decoder))
            case "git.revert": self = .gitRevert(try CeliadorAPI.CommandGitRevert(from: decoder))
            case "git.push": self = .gitPush(try CeliadorAPI.CommandGitPush(from: decoder))
            case "git.pr": self = .gitPr(try CeliadorAPI.CommandGitPr(from: decoder))
            case "git.merge": self = .gitMerge(try CeliadorAPI.CommandGitMerge(from: decoder))
            default: self = .unknown(kind: kind, payload: try CeliadorAPI.JSONValue(from: decoder))
            }
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .instruct(let value): try value.encode(to: encoder)
            case .approve(let value): try value.encode(to: encoder)
            case .reject(let value): try value.encode(to: encoder)
            case .answer(let value): try value.encode(to: encoder)
            case .cancel(let value): try value.encode(to: encoder)
            case .fsList(let value): try value.encode(to: encoder)
            case .fsRead(let value): try value.encode(to: encoder)
            case .fsWrite(let value): try value.encode(to: encoder)
            case .gitStatus(let value): try value.encode(to: encoder)
            case .gitDiff(let value): try value.encode(to: encoder)
            case .gitCommit(let value): try value.encode(to: encoder)
            case .gitRevert(let value): try value.encode(to: encoder)
            case .gitPush(let value): try value.encode(to: encoder)
            case .gitPr(let value): try value.encode(to: encoder)
            case .gitMerge(let value): try value.encode(to: encoder)
            case .unknown(_, let payload): try payload.encode(to: encoder)
            }
        }
    }

    public struct CommandInstruct: Codable, Sendable, Equatable {
        public var kind: String
        public var text: String

        public init(
            kind: String = "instruct",
            text: String
        ) {
            self.kind = kind
            self.text = text
        }
    }

    public struct CommandApprove: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String

        public init(
            kind: String = "approve",
            requestId: String
        ) {
            self.kind = kind
            self.requestId = requestId
        }
    }

    public struct CommandReject: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String

        public init(
            kind: String = "reject",
            requestId: String
        ) {
            self.kind = kind
            self.requestId = requestId
        }
    }

    public struct CommandAnswer: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var text: String

        public init(
            kind: String = "answer",
            requestId: String,
            text: String
        ) {
            self.kind = kind
            self.requestId = requestId
            self.text = text
        }
    }

    public struct CommandCancel: Codable, Sendable, Equatable {
        public var kind: String

        public init(
            kind: String = "cancel"
        ) {
            self.kind = kind
        }
    }

    public struct CommandFsList: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var path: String

        public init(
            kind: String = "fs.list",
            requestId: String,
            path: String
        ) {
            self.kind = kind
            self.requestId = requestId
            self.path = path
        }
    }

    public struct CommandFsRead: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var path: String

        public init(
            kind: String = "fs.read",
            requestId: String,
            path: String
        ) {
            self.kind = kind
            self.requestId = requestId
            self.path = path
        }
    }

    public struct CommandFsWrite: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var path: String
        public var content: String

        public init(
            kind: String = "fs.write",
            requestId: String,
            path: String,
            content: String
        ) {
            self.kind = kind
            self.requestId = requestId
            self.path = path
            self.content = content
        }
    }

    public struct CommandGitStatus: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String

        public init(
            kind: String = "git.status",
            requestId: String
        ) {
            self.kind = kind
            self.requestId = requestId
        }
    }

    public struct CommandGitDiff: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var path: String?

        public init(
            kind: String = "git.diff",
            requestId: String,
            path: String? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.path = path
        }
    }

    public struct CommandGitCommit: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var message: String
        public var paths: [String]?

        public init(
            kind: String = "git.commit",
            requestId: String,
            message: String,
            paths: [String]? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.message = message
            self.paths = paths
        }
    }

    public struct CommandGitRevert: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var paths: [String]

        public init(
            kind: String = "git.revert",
            requestId: String,
            paths: [String]
        ) {
            self.kind = kind
            self.requestId = requestId
            self.paths = paths
        }
    }

    public struct CommandGitPush: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String

        public init(
            kind: String = "git.push",
            requestId: String
        ) {
            self.kind = kind
            self.requestId = requestId
        }
    }

    public struct CommandGitPr: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var title: String
        public var body: String?
        public var base: String?

        public init(
            kind: String = "git.pr",
            requestId: String,
            title: String,
            body: String? = nil,
            base: String? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.title = title
            self.body = body
            self.base = base
        }
    }

    public struct CommandGitMerge: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var method: CeliadorAPI.CommandGitMerge.Method?
        /// Merge the open pull request of this branch instead of the run's own (an agent task's merge).
        public var head: String?

        public init(
            kind: String = "git.merge",
            requestId: String,
            method: CeliadorAPI.CommandGitMerge.Method? = nil,
            head: String? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.method = method
            self.head = head
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Method: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let merge = Self(rawValue: "merge")
            public static let squash = Self(rawValue: "squash")
            public static let rebase = Self(rawValue: "rebase")

            /// The values this build knows.
            public static let knownValues: [Self] = [.merge, .squash, .rebase]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct FsEntry: Codable, Sendable, Equatable {
        public var name: String
        public var type: CeliadorAPI.FsEntry.TypeValue
        public var size: Int?

        public init(
            name: String,
            type: CeliadorAPI.FsEntry.TypeValue,
            size: Int? = nil
        ) {
            self.name = name
            self.type = type
            self.size = size
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct TypeValue: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let file = Self(rawValue: "file")
            public static let dir = Self(rawValue: "dir")

            /// The values this build knows.
            public static let knownValues: [Self] = [.file, .dir]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct GitFileStatus: Codable, Sendable, Equatable {
        public var path: String
        /// Porcelain-style code ("M", "A", "D", "R", "U", ...).
        public var status: String

        public init(
            path: String,
            status: String
        ) {
            self.path = path
            self.status = status
        }
    }

    /// The runner's answer to an `fs.*` or `git.*` command (one envelope for all of them).
    public struct FsResult: Codable, Sendable, Equatable {
        public var ok: Bool
        public var error: String?
        public var entries: [CeliadorAPI.FsEntry]?
        public var content: String?
        public var encoding: String?
        public var truncated: Bool?
        public var branch: String?
        public var files: [CeliadorAPI.GitFileStatus]?
        public var patch: String?
        public var sha: String?
        /// git.push: the remote the branch went to.
        public var remote: String?
        /// git.pr / git.merge: the pull request's URL (or a compare link).
        public var url: String?
        /// git.pr: whether this call created the pull request.
        public var created: Bool?
        /// git.merge: whether GitHub reports it merged.
        public var merged: Bool?

        public init(
            ok: Bool,
            error: String? = nil,
            entries: [CeliadorAPI.FsEntry]? = nil,
            content: String? = nil,
            encoding: String? = nil,
            truncated: Bool? = nil,
            branch: String? = nil,
            files: [CeliadorAPI.GitFileStatus]? = nil,
            patch: String? = nil,
            sha: String? = nil,
            remote: String? = nil,
            url: String? = nil,
            created: Bool? = nil,
            merged: Bool? = nil
        ) {
            self.ok = ok
            self.error = error
            self.entries = entries
            self.content = content
            self.encoding = encoding
            self.truncated = truncated
            self.branch = branch
            self.files = files
            self.patch = patch
            self.sha = sha
            self.remote = remote
            self.url = url
            self.created = created
            self.merged = merged
        }
    }

    /// A runner's reply to a command, posted on the event channel. Never logged.
    public struct FsResultFrame: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var ok: Bool
        public var error: String?
        public var entries: [CeliadorAPI.FsEntry]?
        public var content: String?
        public var encoding: String?
        public var truncated: Bool?
        public var branch: String?
        public var files: [CeliadorAPI.GitFileStatus]?
        public var patch: String?
        public var sha: String?
        /// git.push: the remote the branch went to.
        public var remote: String?
        /// git.pr / git.merge: the pull request's URL (or a compare link).
        public var url: String?
        /// git.pr: whether this call created the pull request.
        public var created: Bool?
        /// git.merge: whether GitHub reports it merged.
        public var merged: Bool?

        public init(
            kind: String = "fs.result",
            requestId: String,
            ok: Bool,
            error: String? = nil,
            entries: [CeliadorAPI.FsEntry]? = nil,
            content: String? = nil,
            encoding: String? = nil,
            truncated: Bool? = nil,
            branch: String? = nil,
            files: [CeliadorAPI.GitFileStatus]? = nil,
            patch: String? = nil,
            sha: String? = nil,
            remote: String? = nil,
            url: String? = nil,
            created: Bool? = nil,
            merged: Bool? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.ok = ok
            self.error = error
            self.entries = entries
            self.content = content
            self.encoding = encoding
            self.truncated = truncated
            self.branch = branch
            self.files = files
            self.patch = patch
            self.sha = sha
            self.remote = remote
            self.url = url
            self.created = created
            self.merged = merged
        }
    }

    public struct FileContent: Codable, Sendable, Equatable {
        public var path: String
        public var content: String
        public var encoding: String
        public var truncated: Bool

        public init(
            path: String,
            content: String,
            encoding: String,
            truncated: Bool
        ) {
            self.path = path
            self.content = content
            self.encoding = encoding
            self.truncated = truncated
        }
    }

    public struct WriteFileRequest: Codable, Sendable, Equatable {
        public var path: String
        public var content: String

        public init(
            path: String,
            content: String
        ) {
            self.path = path
            self.content = content
        }
    }

    public struct GitStatus: Codable, Sendable, Equatable {
        public var branch: String?
        public var files: [CeliadorAPI.GitFileStatus]

        public init(
            branch: String? = nil,
            files: [CeliadorAPI.GitFileStatus]
        ) {
            self.branch = branch
            self.files = files
        }
    }

    public struct WorkspaceEntry: Codable, Sendable, Equatable {
        public var name: String
        public var remoteUrl: String
        public var branch: String?

        public init(
            name: String,
            remoteUrl: String,
            branch: String? = nil
        ) {
            self.name = name
            self.remoteUrl = remoteUrl
            self.branch = branch
        }
    }

    /// A command pushed to an editor. Editors must ignore kinds they don't know.
    public enum EditorCommand: Codable, Sendable, Equatable {
        case startRun(CeliadorAPI.EditorRunRequest)
        case startTask(CeliadorAPI.EditorTaskRequest)
        /// A kind this build doesn't know (new kinds are additive): ignore it.
        case unknown(kind: String, payload: CeliadorAPI.JSONValue)

        /// The `kind` this value was decoded from.
        public var kind: String {
            switch self {
            case .startRun: return "start-run"
            case .startTask: return "start-task"
            case .unknown(let kind, _): return kind
            }
        }

        private enum DiscriminatorKeys: String, CodingKey { case kind }

        public init(from decoder: any Decoder) throws {
            let kind = try decoder.container(keyedBy: DiscriminatorKeys.self).decode(String.self, forKey: .kind)
            switch kind {
            case "start-run": self = .startRun(try CeliadorAPI.EditorRunRequest(from: decoder))
            case "start-task": self = .startTask(try CeliadorAPI.EditorTaskRequest(from: decoder))
            default: self = .unknown(kind: kind, payload: try CeliadorAPI.JSONValue(from: decoder))
            }
        }

        public func encode(to encoder: any Encoder) throws {
            switch self {
            case .startRun(let value): try value.encode(to: encoder)
            case .startTask(let value): try value.encode(to: encoder)
            case .unknown(_, let payload): try payload.encode(to: encoder)
            }
        }
    }

    /// Start a session on an open workspace (the phone's "Run on your editor").
    public struct EditorRunRequest: Codable, Sendable, Equatable {
        public var kind: String
        public var requestId: String
        public var remoteUrl: String
        public var name: String?
        public var branch: String?
        /// Empty for an idle session.
        public var prompt: String

        public init(
            kind: String = "start-run",
            requestId: String,
            remoteUrl: String,
            name: String? = nil,
            branch: String? = nil,
            prompt: String
        ) {
            self.kind = kind
            self.requestId = requestId
            self.remoteUrl = remoteUrl
            self.name = name
            self.branch = branch
            self.prompt = prompt
        }
    }

    /// Run a queued agent task in its own worktree.
    public struct EditorTaskRequest: Codable, Sendable, Equatable {
        public var kind: String
        public var taskId: String
        public var remoteUrl: String
        public var name: String?
        /// The new branch (and worktree) the run works on.
        public var branch: String
        public var prompt: String
        public var title: String
        public var issue: CeliadorAPI.EditorTaskRequest.Issue?
        /// The daemon already posted the "picked up" comment; the editor must not.
        public var commented: Bool?

        public init(
            kind: String = "start-task",
            taskId: String,
            remoteUrl: String,
            name: String? = nil,
            branch: String,
            prompt: String,
            title: String,
            issue: CeliadorAPI.EditorTaskRequest.Issue? = nil,
            commented: Bool? = nil
        ) {
            self.kind = kind
            self.taskId = taskId
            self.remoteUrl = remoteUrl
            self.name = name
            self.branch = branch
            self.prompt = prompt
            self.title = title
            self.issue = issue
            self.commented = commented
        }

        public struct Issue: Codable, Sendable, Equatable {
            public var number: Int
            public var url: String

            public init(
                number: Int,
                url: String
            ) {
                self.number = number
                self.url = url
            }
        }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct TaskState: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let queued = Self(rawValue: "queued")
        public static let dispatched = Self(rawValue: "dispatched")
        public static let running = Self(rawValue: "running")
        public static let prOpen = Self(rawValue: "pr-open")
        public static let merged = Self(rawValue: "merged")
        public static let failed = Self(rawValue: "failed")
        public static let cancelled = Self(rawValue: "cancelled")

        /// The values this build knows.
        public static let knownValues: [Self] = [.queued, .dispatched, .running, .prOpen, .merged, .failed, .cancelled]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    public struct TaskRepo: Codable, Sendable, Equatable {
        public var owner: String
        public var name: String
        /// `https://github.com/<owner>/<name>.git`
        public var url: String

        public init(
            owner: String,
            name: String,
            url: String
        ) {
            self.owner = owner
            self.name = name
            self.url = url
        }
    }

    public struct TaskIssue: Codable, Sendable, Equatable {
        public var number: Int
        public var title: String
        /// `https://github.com/<owner>/<name>/issues/<number>`
        public var url: String

        public init(
            number: Int,
            title: String,
            url: String
        ) {
            self.number = number
            self.title = title
            self.url = url
        }
    }

    /// What the linked session is blocked on.
    public struct TaskAwaiting: Codable, Sendable, Equatable {
        public var kind: CeliadorAPI.TaskAwaiting.Kind
        /// For the session's approve/reject/answer routes.
        public var requestId: String
        public var text: String
        public var preview: String?
        public var choices: [String]?

        public init(
            kind: CeliadorAPI.TaskAwaiting.Kind,
            requestId: String,
            text: String,
            preview: String? = nil,
            choices: [String]? = nil
        ) {
            self.kind = kind
            self.requestId = requestId
            self.text = text
            self.preview = preview
            self.choices = choices
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Kind: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let permission = Self(rawValue: "permission")
            public static let question = Self(rawValue: "question")

            /// The values this build knows.
            public static let knownValues: [Self] = [.permission, .question]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct TaskChecks: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let passing = Self(rawValue: "passing")
        public static let failing = Self(rawValue: "failing")
        public static let pending = Self(rawValue: "pending")
        public static let none = Self(rawValue: "none")
        public static let unknown = Self(rawValue: "unknown")

        /// The values this build knows.
        public static let knownValues: [Self] = [.passing, .failing, .pending, .none, .unknown]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    public struct TaskPullRequest: Codable, Sendable, Equatable {
        public var number: Int
        public var url: String
        public var additions: Int?
        public var deletions: Int?
        public var changedFiles: Int?
        public var checks: CeliadorAPI.TaskChecks?
        /// False when the pull request has conflicts; absent while GitHub computes it.
        public var mergeable: Bool?
        public var updatedAt: String

        public init(
            number: Int,
            url: String,
            additions: Int? = nil,
            deletions: Int? = nil,
            changedFiles: Int? = nil,
            checks: CeliadorAPI.TaskChecks? = nil,
            mergeable: Bool? = nil,
            updatedAt: String
        ) {
            self.number = number
            self.url = url
            self.additions = additions
            self.deletions = deletions
            self.changedFiles = changedFiles
            self.checks = checks
            self.mergeable = mergeable
            self.updatedAt = updatedAt
        }
    }

    public struct Task: Codable, Sendable, Equatable {
        public var id: String
        public var repo: CeliadorAPI.TaskRepo
        public var issue: CeliadorAPI.TaskIssue?
        public var title: String
        /// What the agent is told.
        public var prompt: String
        public var branch: String
        public var source: CeliadorAPI.Task.Source
        public var state: CeliadorAPI.TaskState
        public var sessionId: String?
        public var prUrl: String?
        public var error: String?
        public var createdAt: String
        public var updatedAt: String
        /// `mac`: an editor took it. `cloud`: the daemon runs it.
        public var runner: CeliadorAPI.Task.Runner?
        public var dispatchedAt: String?
        public var dispatches: Int?
        /// The editor's computer name.
        public var machine: String?
        public var startedAt: String?
        public var finishedAt: String?
        /// The linked session's latest one-line activity.
        public var activity: String?
        public var awaiting: CeliadorAPI.TaskAwaiting?
        public var pr: CeliadorAPI.TaskPullRequest?
        public var usage: CeliadorAPI.Usage?

        public init(
            id: String,
            repo: CeliadorAPI.TaskRepo,
            issue: CeliadorAPI.TaskIssue? = nil,
            title: String,
            prompt: String,
            branch: String,
            source: CeliadorAPI.Task.Source,
            state: CeliadorAPI.TaskState,
            sessionId: String? = nil,
            prUrl: String? = nil,
            error: String? = nil,
            createdAt: String,
            updatedAt: String,
            runner: CeliadorAPI.Task.Runner? = nil,
            dispatchedAt: String? = nil,
            dispatches: Int? = nil,
            machine: String? = nil,
            startedAt: String? = nil,
            finishedAt: String? = nil,
            activity: String? = nil,
            awaiting: CeliadorAPI.TaskAwaiting? = nil,
            pr: CeliadorAPI.TaskPullRequest? = nil,
            usage: CeliadorAPI.Usage? = nil
        ) {
            self.id = id
            self.repo = repo
            self.issue = issue
            self.title = title
            self.prompt = prompt
            self.branch = branch
            self.source = source
            self.state = state
            self.sessionId = sessionId
            self.prUrl = prUrl
            self.error = error
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.runner = runner
            self.dispatchedAt = dispatchedAt
            self.dispatches = dispatches
            self.machine = machine
            self.startedAt = startedAt
            self.finishedAt = finishedAt
            self.activity = activity
            self.awaiting = awaiting
            self.pr = pr
            self.usage = usage
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Source: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let issueLabel = Self(rawValue: "issue-label")
            public static let issueComment = Self(rawValue: "issue-comment")
            public static let manual = Self(rawValue: "manual")

            /// The values this build knows.
            public static let knownValues: [Self] = [.issueLabel, .issueComment, .manual]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }

        /// `mac`: an editor took it. `cloud`: the daemon runs it.
        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Runner: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let mac = Self(rawValue: "mac")
            public static let cloud = Self(rawValue: "cloud")

            /// The values this build knows.
            public static let knownValues: [Self] = [.mac, .cloud]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct TaskEnvelope: Codable, Sendable, Equatable {
        public var task: CeliadorAPI.Task
        public var deduped: Bool?

        public init(
            task: CeliadorAPI.Task,
            deduped: Bool? = nil
        ) {
            self.task = task
            self.deduped = deduped
        }
    }

    public struct RepoLink: Codable, Sendable, Equatable {
        public var url: String
        /// Whether the link carries proof of the user's GitHub access.
        public var verified: Bool
        /// The GitHub account that proved it.
        public var login: String?

        public init(
            url: String,
            verified: Bool,
            login: String? = nil
        ) {
            self.url = url
            self.verified = verified
            self.login = login
        }
    }

    public struct RepoLinks: Codable, Sendable, Equatable {
        /// Linked repo URLs (the same as `repoLinks[].url`).
        public var repos: [String]
        public var repoLinks: [CeliadorAPI.RepoLink]

        public init(
            repos: [String],
            repoLinks: [CeliadorAPI.RepoLink]
        ) {
            self.repos = repos
            self.repoLinks = repoLinks
        }
    }

    public struct RepoLinkResult: Codable, Sendable, Equatable {
        /// Linked repo URLs (the same as `repoLinks[].url`).
        public var repos: [String]
        public var repoLinks: [CeliadorAPI.RepoLink]
        public var verified: Bool
        /// Why the link isn't verified, when it isn't.
        public var message: String?

        public init(
            repos: [String],
            repoLinks: [CeliadorAPI.RepoLink],
            verified: Bool,
            message: String? = nil
        ) {
            self.repos = repos
            self.repoLinks = repoLinks
            self.verified = verified
            self.message = message
        }
    }

    public struct RepoLinkRefusal: Codable, Sendable, Equatable {
        public var error: String
        public var needs: CeliadorAPI.RepoLinkRefusal.Needs?

        public init(
            error: String,
            needs: CeliadorAPI.RepoLinkRefusal.Needs? = nil
        ) {
            self.error = error
            self.needs = needs
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Needs: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let githubConnect = Self(rawValue: "github-connect")
            public static let writeAccess = Self(rawValue: "write-access")

            /// The values this build knows.
            public static let knownValues: [Self] = [.githubConnect, .writeAccess]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct TaskList: Codable, Sendable, Equatable {
        /// Linked repo URLs (the same as `repoLinks[].url`).
        public var repos: [String]
        public var repoLinks: [CeliadorAPI.RepoLink]
        public var tasks: [CeliadorAPI.Task]
        public var concurrency: Int

        public init(
            repos: [String],
            repoLinks: [CeliadorAPI.RepoLink],
            tasks: [CeliadorAPI.Task],
            concurrency: Int
        ) {
            self.repos = repos
            self.repoLinks = repoLinks
            self.tasks = tasks
            self.concurrency = concurrency
        }
    }

    public struct CreateTaskRequest: Codable, Sendable, Equatable {
        /// `https://github.com/<owner>/<name>`
        public var remoteUrl: String
        /// Required unless `issue` is given.
        public var title: String?
        /// Kept up to 20000 characters.
        public var details: String?
        public var issue: CeliadorAPI.TaskIssue?

        public init(
            remoteUrl: String,
            title: String? = nil,
            details: String? = nil,
            issue: CeliadorAPI.TaskIssue? = nil
        ) {
            self.remoteUrl = remoteUrl
            self.title = title
            self.details = details
            self.issue = issue
        }
    }

    public struct TaskStatusReport: Codable, Sendable, Equatable {
        public var state: CeliadorAPI.TaskStatusReport.State
        public var sessionId: String?
        public var prUrl: String?
        public var error: String?
        public var machine: String?
        public var pr: CeliadorAPI.TaskStatusReport.Pr?
        /// The run's final message (pr-open).
        public var summary: String?

        public init(
            state: CeliadorAPI.TaskStatusReport.State,
            sessionId: String? = nil,
            prUrl: String? = nil,
            error: String? = nil,
            machine: String? = nil,
            pr: CeliadorAPI.TaskStatusReport.Pr? = nil,
            summary: String? = nil
        ) {
            self.state = state
            self.sessionId = sessionId
            self.prUrl = prUrl
            self.error = error
            self.machine = machine
            self.pr = pr
            self.summary = summary
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct State: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let running = Self(rawValue: "running")
            public static let prOpen = Self(rawValue: "pr-open")
            public static let merged = Self(rawValue: "merged")
            public static let failed = Self(rawValue: "failed")

            /// The values this build knows.
            public static let knownValues: [Self] = [.running, .prOpen, .merged, .failed]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }

        public struct Pr: Codable, Sendable, Equatable {
            public var number: Int?
            public var additions: Int?
            public var deletions: Int?
            public var changedFiles: Int?

            public init(
                number: Int? = nil,
                additions: Int? = nil,
                deletions: Int? = nil,
                changedFiles: Int? = nil
            ) {
                self.number = number
                self.additions = additions
                self.deletions = deletions
                self.changedFiles = changedFiles
            }
        }
    }

    public struct WebhookResult: Codable, Sendable, Equatable {
        public var ok: Bool
        public var pong: Bool?
        public var ignored: String?
        public var taskId: String?
        public var state: CeliadorAPI.TaskState?
        /// Ids of the tasks whose pull request was refreshed.
        public var refreshed: [String]?
        public var fixing: [String]?
        public var answered: CeliadorAPI.WebhookResult.Answered?
        public var requestId: String?
        /// Properties the spec doesn't name, kept as they came.
        public var additionalProperties: [String: CeliadorAPI.JSONValue]

        public init(
            ok: Bool,
            pong: Bool? = nil,
            ignored: String? = nil,
            taskId: String? = nil,
            state: CeliadorAPI.TaskState? = nil,
            refreshed: [String]? = nil,
            fixing: [String]? = nil,
            answered: CeliadorAPI.WebhookResult.Answered? = nil,
            requestId: String? = nil,
            additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
        ) {
            self.ok = ok
            self.pong = pong
            self.ignored = ignored
            self.taskId = taskId
            self.state = state
            self.refreshed = refreshed
            self.fixing = fixing
            self.answered = answered
            self.requestId = requestId
            self.additionalProperties = additionalProperties
        }

        enum CodingKeys: String, CodingKey {
            case ok
            case pong
            case ignored
            case taskId
            case state
            case refreshed
            case fixing
            case answered
            case requestId
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.ok = try container.decode(Bool.self, forKey: .ok)
            self.pong = try container.decodeIfPresent(Bool.self, forKey: .pong)
            self.ignored = try container.decodeIfPresent(String.self, forKey: .ignored)
            self.taskId = try container.decodeIfPresent(String.self, forKey: .taskId)
            self.state = try container.decodeIfPresent(CeliadorAPI.TaskState.self, forKey: .state)
            self.refreshed = try container.decodeIfPresent([String].self, forKey: .refreshed)
            self.fixing = try container.decodeIfPresent([String].self, forKey: .fixing)
            self.answered = try container.decodeIfPresent(CeliadorAPI.WebhookResult.Answered.self, forKey: .answered)
            self.requestId = try container.decodeIfPresent(String.self, forKey: .requestId)
            let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            var extra: [String: CeliadorAPI.JSONValue] = [:]
            for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
            }
            self.additionalProperties = extra
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(ok, forKey: .ok)
            try container.encodeIfPresent(pong, forKey: .pong)
            try container.encodeIfPresent(ignored, forKey: .ignored)
            try container.encodeIfPresent(taskId, forKey: .taskId)
            try container.encodeIfPresent(state, forKey: .state)
            try container.encodeIfPresent(refreshed, forKey: .refreshed)
            try container.encodeIfPresent(fixing, forKey: .fixing)
            try container.encodeIfPresent(answered, forKey: .answered)
            try container.encodeIfPresent(requestId, forKey: .requestId)
            var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
            }
        }

        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Answered: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let approve = Self(rawValue: "approve")
            public static let reject = Self(rawValue: "reject")
            public static let answer = Self(rawValue: "answer")

            /// The values this build knows.
            public static let knownValues: [Self] = [.approve, .reject, .answer]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct Profile: Codable, Sendable, Equatable {
        public var id: String
        public var email: String?
        public var displayName: String?
        public var avatarUrl: String?
        public var plan: String
        public var settings: [String: CeliadorAPI.JSONValue]
        public var createdAt: String
        public var updatedAt: String

        public init(
            id: String,
            email: String? = nil,
            displayName: String? = nil,
            avatarUrl: String? = nil,
            plan: String,
            settings: [String: CeliadorAPI.JSONValue],
            createdAt: String,
            updatedAt: String
        ) {
            self.id = id
            self.email = email
            self.displayName = displayName
            self.avatarUrl = avatarUrl
            self.plan = plan
            self.settings = settings
            self.createdAt = createdAt
            self.updatedAt = updatedAt
        }

        enum CodingKeys: String, CodingKey {
            case id
            case email
            case displayName = "display_name"
            case avatarUrl = "avatar_url"
            case plan
            case settings
            case createdAt = "created_at"
            case updatedAt = "updated_at"
        }
    }

    public struct ProfileEnvelope: Codable, Sendable, Equatable {
        public var profile: CeliadorAPI.Profile

        public init(
            profile: CeliadorAPI.Profile
        ) {
            self.profile = profile
        }
    }

    public struct ProfilePatch: Codable, Sendable, Equatable {
        public var displayName: String?
        public var avatarUrl: String?
        /// Merged into the stored settings.
        public var settings: [String: CeliadorAPI.JSONValue]?

        public init(
            displayName: String? = nil,
            avatarUrl: String? = nil,
            settings: [String: CeliadorAPI.JSONValue]? = nil
        ) {
            self.displayName = displayName
            self.avatarUrl = avatarUrl
            self.settings = settings
        }

        enum CodingKeys: String, CodingKey {
            case displayName = "display_name"
            case avatarUrl = "avatar_url"
            case settings
        }
    }

    public struct Chat: Codable, Sendable, Equatable {
        public var id: String
        public var title: String?
        public var origin: String
        public var status: String
        public var createdAt: String
        public var updatedAt: String
        public var lastMessageAt: String?

        public init(
            id: String,
            title: String? = nil,
            origin: String,
            status: String,
            createdAt: String,
            updatedAt: String,
            lastMessageAt: String? = nil
        ) {
            self.id = id
            self.title = title
            self.origin = origin
            self.status = status
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.lastMessageAt = lastMessageAt
        }

        enum CodingKeys: String, CodingKey {
            case id
            case title
            case origin
            case status
            case createdAt = "created_at"
            case updatedAt = "updated_at"
            case lastMessageAt = "last_message_at"
        }
    }

    public struct ChatMessage: Codable, Sendable, Equatable {
        public var id: String
        public var role: String
        public var content: CeliadorAPI.JSONValue
        public var seq: Int?
        public var createdAt: String

        public init(
            id: String,
            role: String,
            content: CeliadorAPI.JSONValue,
            seq: Int? = nil,
            createdAt: String
        ) {
            self.id = id
            self.role = role
            self.content = content
            self.seq = seq
            self.createdAt = createdAt
        }

        enum CodingKeys: String, CodingKey {
            case id
            case role
            case content
            case seq
            case createdAt = "created_at"
        }
    }

    public struct DayUsage: Codable, Sendable, Equatable {
        public var requests: Int
        /// Cache reads and writes included.
        public var inputTokens: Int
        public var outputTokens: Int
        public var cacheReadTokens: Int
        public var cacheWriteTokens: Int
        public var costUsd: Double

        public init(
            requests: Int,
            inputTokens: Int,
            outputTokens: Int,
            cacheReadTokens: Int,
            cacheWriteTokens: Int,
            costUsd: Double
        ) {
            self.requests = requests
            self.inputTokens = inputTokens
            self.outputTokens = outputTokens
            self.cacheReadTokens = cacheReadTokens
            self.cacheWriteTokens = cacheWriteTokens
            self.costUsd = costUsd
        }
    }

    public struct Me: Codable, Sendable, Equatable {
        public var userId: String
        public var email: String?
        /// Null without a database (token / no-auth mode) or before the profile exists.
        public var plan: String?
        public var usage: CeliadorAPI.DayUsage
        public var limits: CeliadorAPI.UserLimits
        public var resetsAt: String
        public var tasks: CeliadorAPI.Me.Tasks

        public init(
            userId: String,
            email: String? = nil,
            plan: String? = nil,
            usage: CeliadorAPI.DayUsage,
            limits: CeliadorAPI.UserLimits,
            resetsAt: String,
            tasks: CeliadorAPI.Me.Tasks
        ) {
            self.userId = userId
            self.email = email
            self.plan = plan
            self.usage = usage
            self.limits = limits
            self.resetsAt = resetsAt
            self.tasks = tasks
        }

        public struct Tasks: Codable, Sendable, Equatable {
            public var running: Int
            public var prOpen: Int
            public var mergedLast7Days: Int
            public var costUsdLast7Days: Double
            public var concurrency: Int

            public init(
                running: Int,
                prOpen: Int,
                mergedLast7Days: Int,
                costUsdLast7Days: Double,
                concurrency: Int
            ) {
                self.running = running
                self.prOpen = prOpen
                self.mergedLast7Days = mergedLast7Days
                self.costUsdLast7Days = costUsdLast7Days
                self.concurrency = concurrency
            }
        }
    }

    public struct PushRegistration: Codable, Sendable, Equatable {
        /// An APNs token (hex).
        public var token: String
        /// Anything other than `production` is treated as `sandbox`.
        public var env: CeliadorAPI.PushRegistration.Env?

        public init(
            token: String,
            env: CeliadorAPI.PushRegistration.Env? = nil
        ) {
            self.token = token
            self.env = env
        }

        /// Anything other than `production` is treated as `sandbox`.
        /// Unknown values decode too (the API is additive): compare against the
        /// constants below and keep a fallback for the rest.
        public struct Env: RawRepresentable, Codable, Hashable, Sendable {
            public var rawValue: String
            public init(rawValue: String) { self.rawValue = rawValue }

            public static let production = Self(rawValue: "production")
            public static let sandbox = Self(rawValue: "sandbox")

            /// The values this build knows.
            public static let knownValues: [Self] = [.production, .sandbox]
            public var isKnown: Bool { Self.knownValues.contains(self) }
        }
    }

    public struct GitHubAccount: Codable, Sendable, Equatable {
        /// Whether the Celiador GitHub App is set up on this server.
        public var app: Bool
        public var connected: Bool
        public var login: String?
        public var connectedAt: String?

        public init(
            app: Bool,
            connected: Bool,
            login: String? = nil,
            connectedAt: String? = nil
        ) {
            self.app = app
            self.connected = connected
            self.login = login
            self.connectedAt = connectedAt
        }
    }

    public struct ReleaseAsset: Codable, Sendable, Equatable {
        public var file: String
        public var sha256: String

        public init(
            file: String,
            sha256: String
        ) {
            self.file = file
            self.sha256 = sha256
        }
    }

    public struct Release: Codable, Sendable, Equatable {
        /// e.g. `darwin-arm64`.
        public var platform: String
        /// e.g. `stable`.
        public var quality: String
        /// The build's commit.
        public var version: String
        /// e.g. `1.138.0`.
        public var productVersion: String
        /// Build time, ms since epoch.
        public var timestamp: Int
        public var archive: String
        public var archiveSha256: String
        public var dmg: String?
        public var dmgSha256: String?
        public var assets: [String: CeliadorAPI.ReleaseAsset]?
        /// Markdown.
        public var notes: String?
        public var archiveUrl: String
        public var dmgUrl: String?
        public var assetUrls: [String: String]?

        public init(
            platform: String,
            quality: String,
            version: String,
            productVersion: String,
            timestamp: Int,
            archive: String,
            archiveSha256: String,
            dmg: String? = nil,
            dmgSha256: String? = nil,
            assets: [String: CeliadorAPI.ReleaseAsset]? = nil,
            notes: String? = nil,
            archiveUrl: String,
            dmgUrl: String? = nil,
            assetUrls: [String: String]? = nil
        ) {
            self.platform = platform
            self.quality = quality
            self.version = version
            self.productVersion = productVersion
            self.timestamp = timestamp
            self.archive = archive
            self.archiveSha256 = archiveSha256
            self.dmg = dmg
            self.dmgSha256 = dmgSha256
            self.assets = assets
            self.notes = notes
            self.archiveUrl = archiveUrl
            self.dmgUrl = dmgUrl
            self.assetUrls = assetUrls
        }
    }

    /// The update descriptor the editor's built-in updater reads.
    public struct EditorUpdate: Codable, Sendable, Equatable {
        public var url: String
        public var name: String
        public var notes: String
        public var pubDate: String
        public var version: String
        public var productVersion: String
        public var timestamp: Int
        public var sha256hash: String

        public init(
            url: String,
            name: String,
            notes: String,
            pubDate: String,
            version: String,
            productVersion: String,
            timestamp: Int,
            sha256hash: String
        ) {
            self.url = url
            self.name = name
            self.notes = notes
            self.pubDate = pubDate
            self.version = version
            self.productVersion = productVersion
            self.timestamp = timestamp
            self.sha256hash = sha256hash
        }

        enum CodingKeys: String, CodingKey {
            case url
            case name
            case notes
            case pubDate = "pub_date"
            case version
            case productVersion
            case timestamp
            case sha256hash
        }
    }

    public struct ExtensionControl: Codable, Sendable, Equatable {
        public var malicious: [CeliadorAPI.JSONValue]
        public var deprecated: [String: CeliadorAPI.JSONValue]
        public var search: [CeliadorAPI.JSONValue]
        /// Properties the spec doesn't name, kept as they came.
        public var additionalProperties: [String: CeliadorAPI.JSONValue]

        public init(
            malicious: [CeliadorAPI.JSONValue],
            deprecated: [String: CeliadorAPI.JSONValue],
            search: [CeliadorAPI.JSONValue],
            additionalProperties: [String: CeliadorAPI.JSONValue] = [:]
        ) {
            self.malicious = malicious
            self.deprecated = deprecated
            self.search = search
            self.additionalProperties = additionalProperties
        }

        enum CodingKeys: String, CodingKey {
            case malicious
            case deprecated
            case search
        }

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            self.malicious = try container.decode([CeliadorAPI.JSONValue].self, forKey: .malicious)
            self.deprecated = try container.decode([String: CeliadorAPI.JSONValue].self, forKey: .deprecated)
            self.search = try container.decode([CeliadorAPI.JSONValue].self, forKey: .search)
            let all = try decoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            var extra: [String: CeliadorAPI.JSONValue] = [:]
            for key in all.allKeys where CodingKeys(rawValue: key.stringValue) == nil {
                extra[key.stringValue] = try all.decode(CeliadorAPI.JSONValue.self, forKey: key)
            }
            self.additionalProperties = extra
        }

        public func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(malicious, forKey: .malicious)
            try container.encode(deprecated, forKey: .deprecated)
            try container.encode(search, forKey: .search)
            var all = encoder.container(keyedBy: CeliadorAPI.AnyCodingKey.self)
            for (key, value) in additionalProperties where CodingKeys(rawValue: key) == nil {
                try all.encode(value, forKey: CeliadorAPI.AnyCodingKey(key))
            }
        }
    }

    /// Unknown values decode too (the API is additive): compare against the
    /// constants below and keep a fallback for the rest.
    public struct WaitlistName: RawRepresentable, Codable, Hashable, Sendable {
        public var rawValue: String
        public init(rawValue: String) { self.rawValue = rawValue }

        public static let earlyAccess = Self(rawValue: "early-access")
        public static let windows = Self(rawValue: "windows")
        public static let linux = Self(rawValue: "linux")

        /// The values this build knows.
        public static let knownValues: [Self] = [.earlyAccess, .windows, .linux]
        public var isKnown: Bool { Self.knownValues.contains(self) }
    }

    public struct WaitlistSignup: Codable, Sendable, Equatable {
        public var email: String
        /// Unknown names are dropped; none left means `early-access`.
        public var lists: CeliadorAPI.WaitlistSignup.Lists?
        /// Leave empty (a field people never fill).
        public var website: String?

        public init(
            email: String,
            lists: CeliadorAPI.WaitlistSignup.Lists? = nil,
            website: String? = nil
        ) {
            self.email = email
            self.lists = lists
            self.website = website
        }

        /// Unknown names are dropped; none left means `early-access`.
        public enum Lists: Codable, Sendable, Equatable {
            case waitlistName(CeliadorAPI.WaitlistName)
            case array([CeliadorAPI.WaitlistName])

            public init(from decoder: any Decoder) throws {
                let container = try decoder.singleValueContainer()
                if let value = try? container.decode(CeliadorAPI.WaitlistName.self) { self = .waitlistName(value); return }
                if let value = try? container.decode([CeliadorAPI.WaitlistName].self) { self = .array(value); return }
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "No variant of Lists matched")
            }

            public func encode(to encoder: any Encoder) throws {
                var container = encoder.singleValueContainer()
                switch self {
                case .waitlistName(let value): try container.encode(value)
                case .array(let value): try container.encode(value)
                }
            }
        }
    }

    public struct WaitlistExportRow: Codable, Sendable, Equatable {
        public var email: String
        public var lists: [CeliadorAPI.WaitlistName]
        public var pending: [CeliadorAPI.WaitlistName]
        public var createdAt: String
        public var confirmedAt: String?
        public var unsubscribeUrl: String?

        public init(
            email: String,
            lists: [CeliadorAPI.WaitlistName],
            pending: [CeliadorAPI.WaitlistName],
            createdAt: String,
            confirmedAt: String? = nil,
            unsubscribeUrl: String? = nil
        ) {
            self.email = email
            self.lists = lists
            self.pending = pending
            self.createdAt = createdAt
            self.confirmedAt = confirmedAt
            self.unsubscribeUrl = unsubscribeUrl
        }
    }

    public struct AdminUsage: Codable, Sendable, Equatable {
        public var days: [CeliadorAPI.AdminUsage.DaysItem]

        public init(
            days: [CeliadorAPI.AdminUsage.DaysItem]
        ) {
            self.days = days
        }

        public struct DaysItem: Codable, Sendable, Equatable {
            public var day: String
            public var total: CeliadorAPI.DayUsage
            public var accounts: Int
            public var users: [CeliadorAPI.AdminUsage.DaysItem.UsersItem]

            public init(
                day: String,
                total: CeliadorAPI.DayUsage,
                accounts: Int,
                users: [CeliadorAPI.AdminUsage.DaysItem.UsersItem]
            ) {
                self.day = day
                self.total = total
                self.accounts = accounts
                self.users = users
            }

            public struct UsersItem: Codable, Sendable, Equatable {
                public var requests: Int
                /// Cache reads and writes included.
                public var inputTokens: Int
                public var outputTokens: Int
                public var cacheReadTokens: Int
                public var cacheWriteTokens: Int
                public var costUsd: Double
                public var userId: String
                public var email: String?
                public var createdAt: String?

                public init(
                    requests: Int,
                    inputTokens: Int,
                    outputTokens: Int,
                    cacheReadTokens: Int,
                    cacheWriteTokens: Int,
                    costUsd: Double,
                    userId: String,
                    email: String? = nil,
                    createdAt: String? = nil
                ) {
                    self.requests = requests
                    self.inputTokens = inputTokens
                    self.outputTokens = outputTokens
                    self.cacheReadTokens = cacheReadTokens
                    self.cacheWriteTokens = cacheWriteTokens
                    self.costUsd = costUsd
                    self.userId = userId
                    self.email = email
                    self.createdAt = createdAt
                }
            }
        }
    }
}
