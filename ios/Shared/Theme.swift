import SwiftUI

/// Celiador's design tokens. Lives in `Shared/` so the app, widget, and watch
/// targets share one visual language — keep this file UIKit-free and
/// cross-platform (no haptics / iOS-only APIs; those live in the app's DesignKit).
enum Theme {
    // MARK: Core palette
    static let bg = Color(red: 0.082, green: 0.094, blue: 0.102)
    static let bgDeep = Color(red: 0.055, green: 0.063, blue: 0.075)   // darker base for gradients
    static let panel = Color(red: 0.106, green: 0.122, blue: 0.133)
    static let panelHi = Color(red: 0.133, green: 0.153, blue: 0.169)  // raised surface
    static let border = Color(red: 0.173, green: 0.196, blue: 0.216)
    static let hairline = Color(red: 0.231, green: 0.263, blue: 0.290) // subtle separators
    static let ink = Color(red: 0.914, green: 0.902, blue: 0.871)
    static let dim = Color(red: 0.545, green: 0.573, blue: 0.6)
    static let faint = Color(red: 0.388, green: 0.412, blue: 0.439)    // tertiary text
    static let celadon = Color(red: 0.31, green: 0.635, blue: 0.529)
    static let celadonBright = Color(red: 0.424, green: 0.761, blue: 0.647)
    static let attention = Color(red: 0.851, green: 0.643, blue: 0.255)
    static let red = Color(red: 0.851, green: 0.424, blue: 0.373)

    // MARK: Gradients
    /// The signature app backdrop: deep charcoal with a faint cool lift toward the top.
    static var backgroundGradient: LinearGradient {
        LinearGradient(
            colors: [Color(red: 0.094, green: 0.11, blue: 0.129), bgDeep],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Primary-action fill — celadon moving to its brighter tint.
    static var accentGradient: LinearGradient {
        LinearGradient(colors: [celadon, celadonBright], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// A translucent celadon glow used behind the wordmark and hero elements.
    static var glow: RadialGradient {
        RadialGradient(
            colors: [celadonBright.opacity(0.22), .clear],
            center: .center,
            startRadius: 4,
            endRadius: 240
        )
    }

    // MARK: Shape
    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let pill: CGFloat = 999
    }

    // MARK: Motion
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let snappy = Animation.spring(response: 0.28, dampingFraction: 0.86)
    static let gentle = Animation.easeInOut(duration: 0.35)
}

extension View {
    /// Flat bordered card (kept for existing call sites) with a touch of depth.
    func cardStyle() -> some View {
        padding(14)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).stroke(Theme.border, lineWidth: 1))
    }

    /// A raised surface: subtle top-light gradient, hairline border, soft shadow.
    func elevatedCard(cornerRadius: CGFloat = Theme.Radius.md, padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        LinearGradient(colors: [Theme.panelHi, Theme.panel],
                                       startPoint: .top, endPoint: .bottom)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Theme.hairline, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.28), radius: 10, x: 0, y: 6)
    }
}

extension Color {
    /// Parse spec colors like "#B4552D" (falls back to celadon).
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
            self = Theme.celadon
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
