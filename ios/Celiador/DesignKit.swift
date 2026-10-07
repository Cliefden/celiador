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

/// Signature backdrop: vertical charcoal gradient with a soft celadon glow up top.
struct CeliadorBackground: View {
    var body: some View {
        ZStack {
            Theme.backgroundGradient
            Theme.glow
                .frame(height: 420)
                .offset(y: -220)
                .opacity(0.7)
                .blur(radius: 30)
        }
        .ignoresSafeArea()
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
                .shadow(color: color.opacity(pulsing ? 0.8 : 0), radius: 4)
        }
        .frame(width: size, height: size)
        .onAppear { if pulsing { withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { animate = true } } }
    }
}

/// Compact capsule label for state / metadata.
struct StatusPill: View {
    var text: String
    var color: Color
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text.uppercased())
                .font(.system(size: 10, weight: .bold)).kerning(0.6)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(color.opacity(0.14), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.28), lineWidth: 1))
    }
}

// MARK: - Buttons

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Color(red: 0.04, green: 0.09, blue: 0.07))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.accentGradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(.white.opacity(0.14), lineWidth: 1))
            .shadow(color: Theme.celadon.opacity(configuration.isPressed ? 0.15 : 0.4),
                    radius: configuration.isPressed ? 3 : 12, x: 0, y: configuration.isPressed ? 1 : 6)
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(Theme.snappy, value: configuration.isPressed)
    }
}

struct GhostButtonStyle: ButtonStyle {
    var tint: Color = Theme.ink
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(tint)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Theme.panel.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.hairline, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .animation(Theme.snappy, value: configuration.isPressed)
    }
}

// MARK: - Empty state

struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    @State private var appear = false

    var body: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().fill(Theme.celadon.opacity(0.12)).frame(width: 92, height: 92)
                Circle().stroke(Theme.celadon.opacity(0.25), lineWidth: 1).frame(width: 92, height: 92)
                Image(systemName: icon)
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(Theme.accentGradient)
            }
            .scaleEffect(appear ? 1 : 0.8)
            .opacity(appear ? 1 : 0)

            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.dim)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if let actionTitle, let action {
                Button(actionTitle) { Haptics.tap(); action() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
                    .frame(maxWidth: 240)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .onAppear { withAnimation(Theme.spring.delay(0.05)) { appear = true } }
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
                    LinearGradient(colors: [.clear, Theme.ink.opacity(0.08), .clear],
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
            Circle().fill(Theme.panelHi).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 6) {
                SkeletonBar(width: 170, height: 13)
                SkeletonBar(width: 110, height: 10)
            }
            Spacer()
        }
        .padding(.vertical, 6)
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
                    Text(message).font(.subheadline.weight(.medium)).foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().stroke(Theme.hairline, lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 14, y: 8)
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
    func toast(_ message: Binding<String?>, icon: String = "checkmark.circle.fill", tint: Color = Theme.celadonBright) -> some View {
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
