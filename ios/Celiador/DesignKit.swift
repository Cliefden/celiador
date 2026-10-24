import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Haptics

/// Thin wrapper over UIKit feedback so call sites read intent, not boilerplate.
enum Haptics {
    static func tap() { impact(.light) }
    static func select() {
        #if canImport(UIKit)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
    }
    static func success() { notify(.success) }
    static func warning() { notify(.warning) }
    static func error() { notify(.error) }

    #if canImport(UIKit)
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
    private static func notify(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
    #else
    static func impact(_ style: Int = 0) {}
    private static func notify(_ type: Int = 0) {}
    #endif
}

// MARK: - Brand

/// The Celiador wordmark: serif-italic, accent-gradient fill, optional glow halo.
/// Used on the boot and sign-in screens only; everywhere else the app reads as native.
struct Wordmark: View {
    var size: CGFloat = 34
    var glow: Bool = true

    var body: some View {
        Text("Celiador")
            .font(.system(size: size, weight: .regular, design: .serif).italic())
            .foregroundStyle(Theme.accentGradient)
            .background {
                if glow {
                    Circle().fill(Theme.glow).frame(width: size * 6, height: size * 6).blur(radius: 12)
                }
            }
            .accessibilityAddTraits(.isHeader)
    }
}

/// The app backdrop: the system grouped background (follows light/dark).
struct CeliadorBackground: View {
    var body: some View {
        Theme.bg.ignoresSafeArea()
    }
}

// MARK: - Glass

extension View {
    /// Liquid Glass on iOS 26, a material on earlier systems. For floating panels
    /// (approval card, composer, toasts), not for list rows.
    @ViewBuilder
    func glassPanel(cornerRadius: CGFloat = Theme.Radius.lg) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
        } else {
            self.background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        }
    }

    @ViewBuilder
    func glassCapsule() -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: .capsule)
        } else {
            self.background(.regularMaterial, in: Capsule())
        }
    }

    /// The one filled call-to-action on a screen: glass-prominent on iOS 26, bordered-prominent before.
    @ViewBuilder
    func primaryButton() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glassProminent).controlSize(.large).tint(Theme.accent)
        } else {
            self.buttonStyle(.borderedProminent).controlSize(.large).tint(Theme.accent)
        }
    }

    /// A quiet secondary action beside a primary one.
    @ViewBuilder
    func secondaryButton() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glass).controlSize(.large)
        } else {
            self.buttonStyle(.bordered).controlSize(.large)
        }
    }
}

/// A List or Form on the brand ground: the navy (or cool white) background
/// instead of the system's grouped grey. Rows still need `.listRowBackground(Theme.panel)`.
extension View {
    func brandGround() -> some View {
        self.scrollContentBackground(.hidden).background(CeliadorBackground())
    }
}

// MARK: - Status

/// A state dot that breathes when its session is live.
struct StatusDot: View {
    var color: Color
    var pulsing: Bool = false
    var size: CGFloat = 9
    @State private var animate = false

    var body: some View {
        ZStack {
            if pulsing {
                Circle()
                    .fill(color.opacity(0.5))
                    .frame(width: size, height: size)
                    .scaleEffect(animate ? 2.6 : 1)
                    .opacity(animate ? 0 : 0.6)
            }
            Circle()
                .fill(color)
                .frame(width: size, height: size)
        }
        .frame(width: size, height: size)
        .onAppear { if pulsing { withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { animate = true } } }
    }
}

/// Compact capsule label for state / metadata: sentence case, tinted fill, no border.
struct StatusPill: View {
    var text: String
    var color: Color
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.caption2.weight(.semibold)) }
            Text(text).font(.caption.weight(.semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(color.opacity(0.14), in: Capsule())
    }
}

/// The Settings-style leading icon for a list row: a symbol on a tinted rounded square.
struct IconBadge: View {
    var systemName: String
    var color: Color
    var pulsing: Bool = false

    var body: some View {
        Image(systemName: systemName)
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 32, height: 32)
            .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .symbolEffect(.pulse, isActive: pulsing)
    }
}

// MARK: - Empty state

/// The system's empty-state layout, with an optional primary action.
struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: icon)
        } description: {
            Text(message)
        } actions: {
            if let actionTitle, let action {
                Button(actionTitle) { Haptics.tap(); action() }
                    .primaryButton()
            }
        }
    }
}

// MARK: - Skeleton loading

/// A shimmering placeholder bar for loading states.
struct SkeletonBar: View {
    var width: CGFloat? = nil
    var height: CGFloat = 12
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Theme.panelHi)
            .frame(width: width, height: height)
            .overlay(
                GeometryReader { geo in
                    LinearGradient(colors: [.clear, Color.primary.opacity(0.06), .clear],
                                   startPoint: .leading, endPoint: .trailing)
                        .frame(width: geo.size.width * 0.6)
                        .offset(x: phase * geo.size.width)
                }
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            )
            .onAppear { withAnimation(.linear(duration: 1.3).repeatForever(autoreverses: false)) { phase = 1.4 } }
    }
}

struct SkeletonRow: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.panelHi).frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 6) {
                SkeletonBar(width: 170, height: 13)
                SkeletonBar(width: 110, height: 10)
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Toast

private struct ToastModifier: ViewModifier {
    @Binding var message: String?
    var icon: String
    var tint: Color

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let message {
                HStack(spacing: 8) {
                    Image(systemName: icon).foregroundStyle(tint)
                    Text(message).font(.subheadline.weight(.medium))
                }
                .padding(.horizontal, 16).padding(.vertical, 11)
                .glassCapsule()
                .padding(.bottom, 24)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: message) {
                    try? await Task.sleep(nanoseconds: 2_400_000_000)
                    withAnimation(Theme.spring) { self.message = nil }
                }
            }
        }
        .animation(Theme.spring, value: message)
    }
}

extension View {
    /// Transient bottom toast. Set `message` to show; it clears itself.
    func toast(_ message: Binding<String?>, icon: String = "checkmark.circle.fill", tint: Color = Theme.accent) -> some View {
        modifier(ToastModifier(message: message, icon: icon, tint: tint))
    }
}

// MARK: - Relative time

enum RelativeTime {
    private static let parsers: [ISO8601DateFormatter] = {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return [withFraction, plain]
    }()

    /// "now" / "4m" / "3h" / "2d" / "Mar 5" from an ISO8601 string.
    static func short(_ iso: String) -> String {
        guard let date = parsers.lazy.compactMap({ $0.date(from: iso) }).first else { return "" }
        let secs = Date().timeIntervalSince(date)
        if secs < 45 { return "now" }
        if secs < 3600 { return "\(Int(secs / 60))m" }
        if secs < 86_400 { return "\(Int(secs / 3600))h" }
        if secs < 604_800 { return "\(Int(secs / 86_400))d" }
        let fmt = DateFormatter()
        fmt.dateFormat = "MMM d"
        return fmt.string(from: date)
    }
}
