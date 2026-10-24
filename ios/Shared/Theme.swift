import SwiftUI

/// Celiador's design tokens. Lives in `Shared/` so the app, widget, and watch
/// targets share one visual language — keep this file UIKit-free beyond the
/// system colour lookups below (no haptics / iOS-only APIs; those live in the
/// app's DesignKit).
///
/// The look is the platform's: system surfaces that follow light and dark mode,
/// Liquid Glass bars and controls on iOS 26, SF Pro for text and mono only for
/// code. Celiador adds one accent (celadon) and two semantic colours (attention,
/// red). Everything else is `Color.primary`, `.secondary` and the grouped
/// backgrounds, so the app reads as native rather than themed.
enum Theme {
    // MARK: Brand
    static let celadon = Color(red: 0.31, green: 0.635, blue: 0.529)
    static let celadonBright = Color(red: 0.424, green: 0.761, blue: 0.647)
    static let attention = Color(red: 0.851, green: 0.643, blue: 0.255)
    static let red = Color(red: 0.851, green: 0.424, blue: 0.373)

    // MARK: Surfaces and text (semantic: adapt to light/dark)
    #if canImport(UIKit)
    static let bg = Color(uiColor: .systemGroupedBackground)
    static let bgDeep = Color(uiColor: .systemBackground)
    static let panel = Color(uiColor: .secondarySystemGroupedBackground)
    static let panelHi = Color(uiColor: .tertiarySystemGroupedBackground)
    static let border = Color(uiColor: .separator)
    static let hairline = Color(uiColor: .separator).opacity(0.6)
    static let faint = Color(uiColor: .tertiaryLabel)
    #else
    static let bg = Color(red: 0.082, green: 0.094, blue: 0.102)
    static let bgDeep = Color(red: 0.055, green: 0.063, blue: 0.075)
    static let panel = Color(red: 0.106, green: 0.122, blue: 0.133)
    static let panelHi = Color(red: 0.133, green: 0.153, blue: 0.169)
    static let border = Color(red: 0.173, green: 0.196, blue: 0.216)
    static let hairline = Color(red: 0.231, green: 0.263, blue: 0.290)
    static let faint = Color(red: 0.388, green: 0.412, blue: 0.439)
    #endif
    static let ink = Color.primary
    static let dim = Color.secondary

    // MARK: Gradients
    /// Kept for the widgets' backgrounds; the app itself uses the plain system background.
    static var backgroundGradient: LinearGradient {
        LinearGradient(colors: [bg, bgDeep], startPoint: .top, endPoint: .bottom)
    }

    /// Primary-action fill — celadon moving to its brighter tint (avatars, the wordmark).
    static var accentGradient: LinearGradient {
        LinearGradient(colors: [celadon, celadonBright], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// A translucent celadon glow used behind the wordmark on the boot and login screens.
    static var glow: RadialGradient {
        RadialGradient(
            colors: [celadonBright.opacity(0.18), .clear],
            center: .center,
            startRadius: 4,
            endRadius: 240
        )
    }

    // MARK: Shape (iOS 26 radii: larger, continuous)
    enum Radius {
        static let sm: CGFloat = 12
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let pill: CGFloat = 999
    }

    // MARK: Motion
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.82)
    static let snappy = Animation.spring(response: 0.28, dampingFraction: 0.86)
    static let gentle = Animation.easeInOut(duration: 0.35)
}

extension View {
    /// A grouped-background card: the system's secondary grouped surface, no border, no shadow.
    func cardStyle() -> some View {
        padding(16)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }

    /// Same surface with a configurable radius; "elevated" is now just the card (flat is the modern read).
    func elevatedCard(cornerRadius: CGFloat = Theme.Radius.md, padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
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
