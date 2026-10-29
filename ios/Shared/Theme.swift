import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Celiador's design tokens. Lives in `Shared/` so the app, widget, and watch
/// targets share one visual language — keep this file UIKit-free beyond the
/// colour lookups below (no haptics / iOS-only APIs; those live in the app's
/// DesignKit).
///
/// The palette is the app icon's: a deep navy ground, an electric blue that
/// turns violet across the icon's facets, and a cyan highlight from the orb.
/// Surfaces follow light and dark mode (navy-tinted in the dark, cool white in
/// the light); text is `Color.primary`/`.secondary`. Blue is the accent for
/// everything interactive, violet is the secondary brand note, and the
/// blue→violet gradient is the signature used on the wordmark and avatars.
enum Theme {
    // MARK: Brand (sampled from the icon)
    /// The icon's left facet. Interactive tint: buttons, links, the tab bar, user bubbles.
    static let accent = Color(red: 0.235, green: 0.478, blue: 0.980)        // #3C7AFA
    /// The orb's cyan-blue: highlights, progress, "done".
    static let accentBright = Color(red: 0.373, green: 0.718, blue: 0.984)  // #5FB7FB
    /// The icon's right facet: the secondary brand note (review, pull requests).
    static let violet = Color(red: 0.541, green: 0.302, blue: 0.980)        // #8A4DFA
    /// The orb's pink edge: used only inside the signature gradient.
    static let orchid = Color(red: 0.910, green: 0.627, blue: 0.941)        // #E8A0F0
    static let attention = Color(red: 0.930, green: 0.690, blue: 0.290)
    static let red = Color(red: 0.930, green: 0.400, blue: 0.400)
    /// Diff "added" lines and merged work: a success green kept semantic, not brand.
    static let added = Color(red: 0.282, green: 0.741, blue: 0.467)
    /// "Ready to merge": the queue's green bucket and the Approve-and-merge call
    /// to action. The same semantic success green as `added`, named for its role.
    static let ready = added
    /// Text/icon on a `ready` or `attention` fill (dark, so it reads on both).
    static let onFill = Color(red: 0.06, green: 0.08, blue: 0.07)

    /// Older call sites (widgets) still say celadon; they get the accent.
    static let celadon = accent
    static let celadonBright = accentBright

    // MARK: Surfaces and text (follow light/dark; navy-tinted in the dark like the icon)
    #if canImport(UIKit)
    private static func dynamic(dark: (CGFloat, CGFloat, CGFloat), light: (CGFloat, CGFloat, CGFloat)) -> Color {
        Color(uiColor: UIColor { traits in
            let c = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: c.0, green: c.1, blue: c.2, alpha: 1)
        })
    }
    static let bg = dynamic(dark: (0.043, 0.071, 0.137), light: (0.953, 0.961, 0.980))       // #0B1223 / #F3F5FA
    static let bgDeep = dynamic(dark: (0.035, 0.047, 0.094), light: (1, 1, 1))               // #090C18 / white
    static let panel = dynamic(dark: (0.078, 0.106, 0.192), light: (1, 1, 1))                // #141B31 / white
    static let panelHi = dynamic(dark: (0.114, 0.145, 0.259), light: (0.914, 0.925, 0.961))  // #1D2542 / #E9ECF5
    static let border = Color(uiColor: .separator)
    static let hairline = Color(uiColor: .separator).opacity(0.6)
    static let faint = Color(uiColor: .tertiaryLabel)
    #else
    static let bg = Color(red: 0.043, green: 0.071, blue: 0.137)
    static let bgDeep = Color(red: 0.035, green: 0.047, blue: 0.094)
    static let panel = Color(red: 0.078, green: 0.106, blue: 0.192)
    static let panelHi = Color(red: 0.114, green: 0.145, blue: 0.259)
    static let border = Color(red: 0.2, green: 0.23, blue: 0.33)
    static let hairline = Color(red: 0.2, green: 0.23, blue: 0.33).opacity(0.6)
    static let faint = Color(red: 0.45, green: 0.48, blue: 0.56)
    #endif
    static let ink = Color.primary
    static let dim = Color.secondary

    // MARK: Gradients
    /// Widget backgrounds: the icon's navy, deepening downward.
    static var backgroundGradient: LinearGradient {
        LinearGradient(colors: [bg, bgDeep], startPoint: .top, endPoint: .bottom)
    }

    /// The signature: the icon's blue facet turning violet. Wordmark, avatars, hero accents.
    static var accentGradient: LinearGradient {
        LinearGradient(colors: [accent, violet], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// The orb: cyan into pink. Reserved for the boot/sign-in glow and the avatar highlight.
    static var orbGradient: LinearGradient {
        LinearGradient(colors: [accentBright, orchid], startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    /// A translucent blue glow behind the wordmark on the boot and sign-in screens.
    static var glow: RadialGradient {
        RadialGradient(
            colors: [accent.opacity(0.22), violet.opacity(0.08), .clear],
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
    /// A grouped-background card: the panel surface, no border, no shadow.
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
    /// Parse spec colors like "#B4552D" (falls back to the accent).
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
            self = Theme.accent
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
